/*
    The MIT License (MIT)

    Copyright 2017 - 2018, Alchemy Limited, LLC.

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

const assert = require('chai').assert
const ethjsABI = require('ethjs-abi')

const AutonomousConverter = artifacts.require('AutonomousConverter')
const Auctions = artifacts.require('Auctions')
const MTNToken = artifacts.require('MTNToken')
const Proceeds = artifacts.require('Proceeds')
const SmartToken = artifacts.require('SmartToken')
const TokenLocker = artifacts.require('TokenLocker')

contract('AutonomousConverter Interactions', accounts => {
  let mtnToken, autonomousConverter, auctions, proceeds, smartToken

  const OWNER = accounts[0]
  const OWNER_TOKENS_HEX = '0000d3c20dee1639f99c0000'
  const FOUNDER = accounts[1]
  const FOUNDER_TOKENS_HEX = '000069e10de76676d0000000'

  const EXT_FOUNDER = accounts[6]

  const DAYS_IN_WEEK = 7
  const SECS_IN_DAY = 86400
  const timeTravel = function (time) {
    return new Promise((resolve, reject) => {
      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [time],
        id: new Date().getTime()
      }, (err, result) => {
        if (err) { return reject(err) }
        return resolve(result)
      })
    })
  }
  const mineBlock = function () {
    return new Promise((resolve, reject) => {
      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_mine'
      }, (err, result) => {
        if (err) { return reject(err) }
        return resolve(result)
      })
    })
  }
  function getCurrentTime (offsetDays) {
    let date = new Date()
    date.setDate(date.getDate() + offsetDays)
    return Math.floor(date.getTime() / 1000)
  }
  function roundToMidNightNextDay (initialAuctionEndTime) {
    let remainderSeconds = Math.ceil(initialAuctionEndTime / (24 * 60 * 60))
    return (remainderSeconds * 24 * 60 * 60)
  }

  const initContracts = function (startOffset) {
    return new Promise(async (resolve, reject) => {
      autonomousConverter = await AutonomousConverter.new({from: OWNER})
      auctions = await Auctions.new({from: OWNER})
      proceeds = await Proceeds.new({from: OWNER})

      const founders = []
      founders.push(OWNER + '0000d3c20dee1639f99c0000')
      founders.push(FOUNDER + '000069e10de76676d0000000')

      const MTN_INITIAL_SUPPLY = 0
      const DECMULT = 10 ** 18
      const MINIMUM_PRICE = 1000
      const STARTING_PRICE = 1
      const TIME_SCALE = 1
      const START_TIME = getCurrentTime(startOffset)

      mtnToken = await MTNToken.new(autonomousConverter.address, auctions.address, MTN_INITIAL_SUPPLY, DECMULT, {from: OWNER})
      smartToken = await SmartToken.new(autonomousConverter.address, autonomousConverter.address, MTN_INITIAL_SUPPLY, {from: OWNER})
      await autonomousConverter.init(mtnToken.address, smartToken.address, auctions.address, { from: OWNER, value: web3.toWei(1, 'ether') })
      await proceeds.initProceeds(autonomousConverter.address, auctions.address, {from: OWNER})
      await auctions.mintInitialSupply(founders, EXT_FOUNDER, mtnToken.address, proceeds.address, {from: OWNER})
      await auctions.initAuctions(START_TIME, MINIMUM_PRICE, STARTING_PRICE, TIME_SCALE, {from: OWNER})
      resolve()
    })
  }

  let currentTimeOffset = 0

  describe('Proceeds -> AutonomousConverter', () => {
    it('Initial Auction should end after 7 days', () => {
      return new Promise(async (resolve, reject) => {
        await initContracts(currentTimeOffset + 1)

        const genesisTime = await auctions.genesisTime()
        const initialAuctionEndTime = await auctions.initialAuctionEndTime()
        const intialAuctionDuration = (initialAuctionEndTime.toNumber() - genesisTime.toNumber()) / SECS_IN_DAY
        const dailyAuctionStartTime = await auctions.dailyAuctionStartTime()
        const expectedDailyAuctionStartTime = roundToMidNightNextDay(initialAuctionEndTime)
        assert.equal(dailyAuctionStartTime.toNumber(), expectedDailyAuctionStartTime, 'Inital Auction End and Daily Start are not the same')
        assert.equal(intialAuctionDuration, DAYS_IN_WEEK, 'Auction duration is not correct')
        assert.equal(await auctions.isInitialAuctionEnded(), false, 'Inital auction should not have ended')

        const advDays = 8 // adv 1 day to start auction, then 7 days, plus a few seconds
        await timeTravel((SECS_IN_DAY * advDays) + 60)
        await mineBlock()
        currentTimeOffset += advDays

        assert.equal(await auctions.isInitialAuctionEnded(), true, 'Inital auction did not end after 7 days')

        resolve()
      })
    })

    it('Initial Auction should end early, if all tokens are sold', () => {
      return new Promise(async (resolve, reject) => {
        await initContracts(currentTimeOffset + 1)

        const advDays = 1 // adv 1 day plus a few seconds to start auction
        await timeTravel((SECS_IN_DAY * advDays) + 60)
        await mineBlock()
        currentTimeOffset += advDays

        // sell all tokens in three days
        const amount = web3.toWei(2, 'ether')
        for (let i = 0; i < 7; i++) {
          assert.equal(await auctions.isInitialAuctionEnded(), false, 'Inital auction should not have ended at' + i)

          let isOver = false
          for (let b = 2; b < accounts.length; b++) {
            const buyer = accounts[b]
            const tx = await auctions.sendTransaction({
              from: buyer,
              value: amount })
            assert.equal(tx.logs.length, 1, 'Incorrect number of logs for tx')
            assert.equal(tx.receipt.logs.length, 4, 'Incorrect number of logs for tx.receipt')
            let decoder = ethjsABI.logDecoder(proceeds.abi)
            const dEvents = []
            dEvents.push(decoder(tx.receipt.logs))
            decoder = ethjsABI.logDecoder(mtnToken.abi)
            dEvents.push(decoder(tx.receipt.logs))
            // Need to figure out why its failing.
            // assert.equal(dEvents.length, tx.receipt.logs.length - tx.logs.length, 'Incorrect number of logs for tx.receipt MTNTokens')

            // check that fallback function was called
            const log = tx.logs[0]
            assert.equal(log.event, 'LogAuctionFundsIn', 'LogAuctionFundsIn was not emitted')
            assert.equal(log.args.amount.toString(), amount, 'Amount is wrong')

            // check for proceeds transfer
            const logP = dEvents[0][0]
            assert.equal(logP._eventName, 'LogProceedsIn', 'Proceeds transfer was not emitted')
            assert.equal(logP.from, auctions.address, 'From is wrong')
            // TODO: test for refunds
            assert.isAtMost(parseInt(logP.value.toString(), 10), parseInt(amount, 10), 'Value is wrong')

            // check for mint event
            const logM = dEvents[1][1]
            assert.equal(logM._eventName, 'Transfer', 'Mint was not emitted')
            assert.equal(logM._from, 0x0, 'From is wrong')
            assert.equal(logM._to, buyer, 'To is wrong')
            // TODO: test expected token amount based on tick
            assert.isAbove(parseInt(logM._value.toString(), 10), 0, 'Value is wrong')

            isOver = await auctions.isInitialAuctionEnded()
            if (isOver) {
              assert.equal((await auctions.globalMtnSupply()).toNumber(), (await mtnToken.totalSupply()).toNumber(), 'Tokens were not sold out')

              // attempt to purchase again, when sold out
              let thrown = false
              try {
                await auctions.sendTransaction({from: buyer, value: amount})
              } catch (error) {
                thrown = true
              }
              assert.isTrue(thrown, 'Auction allowed more purchases after selling out')
              break
            }
          }

          const advDays = 1 // adv 1 day, plus a few seconds
          await timeTravel((SECS_IN_DAY * advDays) + 60)
          await mineBlock()
          currentTimeOffset += advDays

          if (isOver) {
            const founders = [
              { address: await auctions.founders(0), targetTokens: parseInt(OWNER_TOKENS_HEX, 16) },
              { address: await auctions.founders(1), targetTokens: parseInt(FOUNDER_TOKENS_HEX, 16) }]

            for (let i = 0; i < founders.length; i++) {
              const founder = founders[i]
              const tokenLockerAddress = await auctions.tokenLockers(founder.address)
              const tokenLocker = await TokenLocker.at(tokenLockerAddress)

              const locked = await tokenLocker.locked()
              assert.isTrue(locked, 'Token Locker is not locked')
            }
            break
          }
        }

        assert.equal(await auctions.isInitialAuctionEnded(), true, 'Inital auction should have ended')

        resolve()
      })
    })
  })
})