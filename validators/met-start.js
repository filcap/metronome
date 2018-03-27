console.log('MET Validator Running...')

const argv = require('minimist')(process.argv.slice(2))
const config = require('./' + argv.config)
console.log('Node:', config.nodeUrl)
console.log("TokenPorter Address:", config.TokenPorterAddr)
console.log("TokenPorter Source:", config.TokenPorterSource)

const Web3 = require('web3')
const web3 = new Web3(new Web3.providers.HttpProvider(config.nodeUrl));

const TokenPorter = require(config.TokenPorterSource)

const contract = web3.eth.contract(TokenPorter.abi).at(config.TokenPorterAddr)

console.log('Listening for ExportReceiptLog...')
contract.ExportReceiptLog().watch(function (err, response) {
	if(err) {
		console.log('export error', err)
	} else {
		console.log('export receipt found', JSON.stringify(response))
	}
})
