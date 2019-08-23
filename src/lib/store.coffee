# + requires 'iap', which is set as a property in order to be mockable
AbstractAPI = require "../AbstractAPI.coffee"
api = require "../api.coffee"
async = require "async"
errors = require "../errors.coffee"
http = require "http"
ObjectID = require('mongodb').ObjectID
request = require "superagent"
stream = require 'stream'
_ = require "underscore"

moduleName = "In-app billing"
privateDomain = (game)->
	return "#{game.appid}.#{game.apisecret}"

class StoreAPI extends AbstractAPI
	constructor: ()->
		super()

	configure: (@xtralifeApi, callback)->
		async.parallel [
			(cb)=>
				@coll('productDefinition').createIndex({appid:1}, {unique: true}, cb)
		], (err)->
			return callback err if err?
			logger.info "#{moduleName} initialized"
			callback()
		@IAP = require('iap')

	# remove common data
	onDeleteUser: (userid, callback)->
		logger.debug "delete user #{userid} for #{moduleName}"
		callback null

	# BO only
	addProduct: (game, product, cb)->
		# Check for duplicate
		@_fetchProducts game.appid, (err, products)=>
			return cb err if err?
			if @_hasProductDuplicate(product, products) > 0
				return cb new errors.DuplicateProduct()

			# Add the new entry
			@coll('productDefinition').updateOne {appid: game.appid}, {$push: {products: product}}, {upsert: true}, (err, result)->
				return cb err if err?
				cb null, result.result.n

	# BO only
	deleteProduct: (game, productId, cb)->
		@coll('productDefinition').updateOne {appid: game.appid}, {$pull: {products: {productId: productId}}}, (err, result)->
			return cb err if err?
			cb null, result.result.n

	getPurchaseHistory: (game, user_id, cb)->
		@coll('domains').findOne {domain: privateDomain(game), user_id : user_id}, {projection:{purchases: 1}}, (err, doc)=>
			cb err, doc?.purchases

	listProducts: (game, skip, limit, cb)->
		@_fetchProducts game.appid, (err, products)->
			return cb err if err?
			cb null, products.length, products[skip..(skip+limit-1)]

	setProducts: (game, products, cb)->
		@coll('productDefinition').updateOne {appid: game.appid}, {$set: products: products}, {upsert: true}, (err, result)->
			return cb err if err?
			cb null, result.result.n

# Only for tests
	TEST_clearStoreTransaction: (storeTransaction, cb)->
		@coll('storeTransaction').deleteOne {_id: storeTransaction}, (err, result)->
			cb err

	TEST_setProductDefinitions: (appid, productDefinitions, cb)->
		@coll('productDefinition').updateOne {appid: appid}, {$set: {products: productDefinitions}}, {upsert: true}, (err, result)->
			cb err

	# BO only
	updateProduct: (game, productId, product, cb)->
		# Do not allow to modify the ID
		product.productId = productId

		# Check for duplicates
		@_fetchProducts game.appid, (err, products)=>
			return cb err if err?
			existingProduct = p for p in products when p.productId is productId
			# Highlight modified fields to include only them
			checkedProduct = {}
			checkedProduct.appStoreId = product.appStoreId unless existingProduct.appStoreId is product.appStoreId
			checkedProduct.googlePlayId = product.googlePlayId unless existingProduct.googlePlayId is product.googlePlayId
			if @_hasProductDuplicate(checkedProduct, products) > 0
				return cb new errors.DuplicateProduct()

			@coll('productDefinition').updateOne {appid: game.appid, "products.productId": productId}
			, {$set: {"products.$": product}}, (err, result)->
				return cb err if err?
				cb null, result.result.n

	validateReceipt: (context, game, user_id, storeType, productId, price, currency, receiptString, receiptSignature, callback)->
		purchase =
			productId: productId
			store: storeType
			dateTime: new Date()
			price: price
			currency: currency

		# Ran at the very end
		receiptValidated = (err, product, transactionId, storeResponseJson)=>
			# Store the fact that the transaction was denied
			if err?
				if err instanceof errors.PurchaseNotConfirmed or err instanceof errors.ExternalStoreEnvironmentError
					return @coll('domains').updateOne {domain: privateDomain(game), user_id : user_id}, {$push: {deniedPurchases: purchase}}, {upsert: true}, (callerr, doc)->
						return callback err
				else
					return callback err

			# Check that the transaction wasn't already processed in storeTransaction
			# Note that processing a transaction twice is not eliminatory, as the customer might simply not have received
			# the notification required to consume the product. Thus we simply won't play the transaction again.
			purchase.storeTransactionId = "#{transactionId}"
			txId = "#{storeType}.#{transactionId}"
			@coll('storeTransaction').updateOne {_id: txId}, $set: {storeResponse: storeResponseJson}, {upsert: true}, (err, result)=>
				return callback err if err?

				# Needs process the transaction
				if result.result.nModified > 0 or result.result.upserted?
					# Store in purchase history
					@coll('domains').updateOne {domain: privateDomain(game), user_id : user_id}, {$push: {purchases: purchase}}, {upsert: true}, (err, doc)=>
						return callback err if err?

						# Run the actual transaction
						if product.reward?.tx? and Object.keys(product.reward.tx).length > 0
							runTransaction = (domain)=>
								description = product.reward.description or "Triggered by purchase of #{productId}"
								@xtralifeApi.transaction.transaction(context, domain, user_id, product.reward.tx, description, false)
								.spread (balance, achievements)->
									callback null, {ok: 1, repeated: 0, purchase: purchase}
								.catch callback
								.done()

							# Check the domain if needed
							if product.reward.domain isnt "private"
								domain = product.reward.domain
								@xtralifeApi.game.checkDomain game, domain, (err, isOk)=>
									return callback err if err?
									return callback new errors.RestrictedDomain unless isOk
									runTransaction domain
							else
								runTransaction privateDomain(game)
						else
							# No transaction to run
							callback null, {ok: 1, repeated: 0, purchase: purchase}
				else
					logger.info "Transaction #{transactionId} for store #{storeType} already played"
					# Enrich with previous transaction info
					@_findPurchase game, user_id, transactionId, (err, purchase)->
						result = {ok: 1, repeated: 1}
						result.purchase = purchase if purchase?
						callback null, result

		# Launch the validation
		@_fetchProducts game.appid, (err, products)=>
			return callback err if err?
			# Make sure the product exists
			product = p for p in products when p.productId is productId
			return callback new errors.InvalidProduct unless product?

			# We need to communicate with the actual store to validate the receipt properly
			switch storeType
				when "appstore", "macstore"
					@_validateAppStoreReceipt game, user_id, storeType, product, receiptString, receiptValidated
				when "googleplay"
					@_validateGooglePlayReceipt game, user_id, product, receiptString, receiptValidated
				else
					callback errors.BadArgument

	_fetchProducts: (appid, cb)->
		@coll('productDefinition').findOne {appid: appid}, {projection:{products: 1}}, (err, result)=>
			return cb err if err?
			cb null, result?.products or []

	_findPurchase: (game, user_id, storeTransactionId, cb)->
		@coll('domains').findOne {domain: privateDomain(game), user_id : user_id}, (err, domain)=>
			return cb err if err?

			getPurchase = ()->
				if domain?
					return p for p in (domain.purchases or []) when p.storeTransactionId is storeTransactionId
				return null
			cb null, getPurchase()

	_hasProductDuplicate: (toInsert, products)->
		return (p for p in products when (toInsert.productId? and p.productId is toInsert.productId) or
			(toInsert.appStoreId? and p.appStoreId is toInsert.appStoreId) or
			(toInsert.googlePlayId? and p.googlePlayId is toInsert.googlePlayId)).length > 0

	# Callback: (err, storeType, product, transactionId, storeResponseJson)
	_validateAppStoreReceipt: (game, user_id, storeType, product, receipt, cb)->
		payment =
			receipt: receipt

		@IAP.verifyPayment 'apple', payment, (error, response)=>
			if error?
				switch error.status
					when 21000, 21002, 21003, 21004, 21006 then return cb new errors.PurchaseNotConfirmed(2, "Error checking the purchase: " + JSON.stringify(error))
					when 21007, 21008 then return cb new errors.ExternalStoreEnvironmentError(error.status)
					else return cb new errors.ExternalServerTempError(error.status)

			expectedProduct = switch storeType
				when "appstore" then product.appStoreId
				when "macstore" then product.macStoreId
			appleProduct = _.filter(response.receipt?.in_app, (each)-> each.product_id is expectedProduct)
			if appleProduct.length > 0
				cb null, product, appleProduct[0].transaction_id, response
			else
				cb new errors.PurchaseNotConfirmed(1, "Product not purchased")

	# Callback: (err, storeType, product, transactionId, storeResponseJson)
	_validateGooglePlayReceipt: (game, user_id, product, receipt, cb)->
		@xtralifeApi.game.getCerts game.appid, (err, certs)=>
			return cb err? if err?

			if not certs.android.packageid
				return cb new errors.PurchaseNotConfirmed(5, "Package ID not configured in the backoffice")

			try
				keyObject = JSON.parse(certs.android.keyobject)
			catch err
				return cb new errors.PurchaseNotConfirmed(5, "Google Service Account not configured in the backoffice")

			try
				receiptObject = JSON.parse(receipt)
			catch err
				return errors.PurchaseNotConfirmed(1, "Invalid receipt (unparsable)")

			if product.googlePlayId isnt 'android.test.purchased'
				payment =
					receipt: receiptObject.purchaseToken
					productId: product.googlePlayId
					packageName: certs.android.packageid
					keyObject: keyObject

				@IAP.verifyPayment 'google', payment, (error, response)=>
					if error? then return cb new errors.PurchaseNotConfirmed(2, "Error checking the purchase: " + JSON.stringify(error))
					cb null, product, response.transactionId, response
			else
				# Android.test.purchased item, skip many checks
				return cb new errors.PurchaseNotConfirmed(4) unless receiptObject.productId is product.googlePlayId
				cb null, product, receiptObject.orderId + new ObjectID()

module.exports = new StoreAPI()
