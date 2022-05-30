/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// + requires 'iap', which is set as a property in order to be mockable
const AbstractAPI = require("../AbstractAPI.js");
const api = require("../api.js");
const async = require("async");
const errors = require("../errors.js");
const http = require("http");
const {
	ObjectId
} = require('mongodb');
const request = require("superagent");
const stream = require('stream');
const _ = require("underscore");

const moduleName = "In-app billing";
const privateDomain = game => `${game.appid}.${game.apisecret}`;

class StoreAPI extends AbstractAPI {
	constructor() {
		super();
	}

	configure(xtralifeApi, callback) {
		this.xtralifeApi = xtralifeApi;
		async.parallel([
			cb => {
				return this.coll('productDefinition').createIndex({ appid: 1 }, { unique: true }, cb);
			}
		], function (err) {
			if (err != null) { return callback(err); }
			logger.info(`${moduleName} initialized`);
			return callback();
		});
		return this.IAP = require('iap');
	}

	// remove common data
	onDeleteUser(userid, callback) {
		logger.debug(`delete user ${userid} for ${moduleName}`);
		return callback(null);
	}

	// BO only
	addProduct(game, product, cb) {
		// Check for duplicate
		return this._fetchProducts(game.appid, (err, products) => {
			if (err != null) { return cb(err); }
			if (this._hasProductDuplicate(product, products) > 0) {
				return cb(new errors.DuplicateProduct());
			}

			// Add the new entry
			return this.coll('productDefinition').updateOne({ appid: game.appid }, { $push: { products: product } }, { upsert: true }, function (err, result) {
				if (err != null) { return cb(err); }
				return cb(null, result.modifiedCount);
			});
		});
	}

	// BO only
	deleteProduct(game, productId, cb) {
		return this.coll('productDefinition').updateOne({ appid: game.appid }, { $pull: { products: { productId } } }, function (err, result) {
			if (err != null) { return cb(err); }
			return cb(null, result.modifiedCount);
		});
	}

	getPurchaseHistory(game, user_id, cb) {
		return this.coll('domains').findOne({ domain: privateDomain(game), user_id }, { projection: { purchases: 1 } }, (err, doc) => {
			return cb(err, doc != null ? doc.purchases : undefined);
		});
	}

	listProducts(game, skip, limit, cb) {
		return this._fetchProducts(game.appid, function (err, products) {
			if (err != null) { return cb(err); }
			return cb(null, products.length, products.slice(skip, +((skip + limit) - 1) + 1 || undefined));
		});
	}

	setProducts(game, products, cb) {
		return this.coll('productDefinition').updateOne({ appid: game.appid }, { $set: { products } }, { upsert: true }, function (err, result) {
			if (err != null) { return cb(err); }
			return cb(null, result.modifiedCount);
		});
	}

	// Only for tests
	TEST_clearStoreTransaction(storeTransaction, cb) {
		return this.coll('storeTransaction').deleteOne({ _id: storeTransaction }, (err, result) => cb(err));
	}

	TEST_setProductDefinitions(appid, productDefinitions, cb) {
		return this.coll('productDefinition').updateOne({ appid }, { $set: { products: productDefinitions } }, { upsert: true }, (err, result) => cb(err));
	}

	// BO only
	updateProduct(game, productId, product, cb) {
		// Do not allow to modify the ID
		product.productId = productId;

		// Check for duplicates
		return this._fetchProducts(game.appid, (err, products) => {
			let existingProduct;
			if (err != null) { return cb(err); }
			for (let p of Array.from(products)) { if (p.productId === productId) { existingProduct = p; } }
			// Highlight modified fields to include only them
			const checkedProduct = {};
			if (existingProduct.appStoreId !== product.appStoreId) { checkedProduct.appStoreId = product.appStoreId; }
			if (existingProduct.googlePlayId !== product.googlePlayId) { checkedProduct.googlePlayId = product.googlePlayId; }
			if (this._hasProductDuplicate(checkedProduct, products) > 0) {
				return cb(new errors.DuplicateProduct());
			}

			return this.coll('productDefinition').updateOne({ appid: game.appid, "products.productId": productId }
				, { $set: { "products.$": product } }, function (err, result) {
					if (err != null) { return cb(err); }
					return cb(null, result.modifiedCount);
				});
		});
	}

	validateReceipt(context, game, user_id, storeType, productId, price, currency, receiptString, receiptSignature, callback) {
		const purchase = {
			productId,
			store: storeType,
			dateTime: new Date(),
			price,
			currency
		};

		// Ran at the very end
		const receiptValidated = (err, product, transactionId, storeResponseJson) => {
			// Store the fact that the transaction was denied
			if (err != null) {
				if (err instanceof errors.PurchaseNotConfirmed || err instanceof errors.ExternalStoreEnvironmentError) {
					return this.coll('domains').updateOne({ domain: privateDomain(game), user_id }, { $push: { deniedPurchases: purchase } }, { upsert: true }, (callerr, doc) => callback(err));
				} else {
					return callback(err);
				}
			}

			// Check that the transaction wasn't already processed in storeTransaction
			// Note that processing a transaction twice is not eliminatory, as the customer might simply not have received
			// the notification required to consume the product. Thus we simply won't play the transaction again.
			purchase.storeTransactionId = `${transactionId}`;
			const txId = `${storeType}.${transactionId}`;
			return this.coll('storeTransaction').updateOne({ _id: txId }, { $set: { storeResponse: storeResponseJson } }, { upsert: true }, (err, result) => {
				if (err != null) { return callback(err); }

				// Needs process the transaction
				if ((result.modifiedCount > 0) || (result.upsertedCount > 0)) {
					// Store in purchase history
					return this.coll('domains').updateOne({ domain: privateDomain(game), user_id }, { $push: { purchases: purchase } }, { upsert: true }, (err, doc) => {
						if (err != null) { return callback(err); }

						// Run the actual transaction
						if (((product.reward != null ? product.reward.tx : undefined) != null) && (Object.keys(product.reward.tx).length > 0)) {
							const runTransaction = domain => {
								const description = product.reward.description || `Triggered by purchase of ${productId}`;
								return this.xtralifeApi.transaction.transaction(context, domain, user_id, product.reward.tx, description, false)
									.spread((balance, achievements) => callback(null, { ok: 1, repeated: 0, purchase }))
									.catch(callback)
									.done();
							};

							// Check the domain if needed
							if (product.reward.domain !== "private") {
								const {
									domain
								} = product.reward;
								return this.xtralifeApi.game.checkDomain(game, domain, (err, isOk) => {
									if (err != null) { return callback(err); }
									if (!isOk) { return callback(new errors.RestrictedDomain); }
									return runTransaction(domain);
								});
							} else {
								return runTransaction(privateDomain(game));
							}
						} else {
							// No transaction to run
							return callback(null, { ok: 1, repeated: 0, purchase });
						}
					});
				} else {
					logger.info(`Transaction ${transactionId} for store ${storeType} already played`);
					// Enrich with previous transaction info
					return this._findPurchase(game, user_id, transactionId, function (err, purchase) {
						result = { ok: 1, repeated: 1 };
						if (purchase != null) { result.purchase = purchase; }
						return callback(null, result);
					});
				}
			});
		};

		// Launch the validation
		return this._fetchProducts(game.appid, (err, products) => {
			let product;
			if (err != null) { return callback(err); }
			// Make sure the product exists
			for (let p of Array.from(products)) { if (p.productId === productId) { product = p; } }
			if (product == null) { return callback(new errors.InvalidProduct); }

			// We need to communicate with the actual store to validate the receipt properly
			switch (storeType) {
				case "appstore": case "macstore":
					return this._validateAppStoreReceipt(game, user_id, storeType, product, receiptString, receiptValidated);
				case "googleplay":
					return this._validateGooglePlayReceipt(game, user_id, product, receiptString, receiptValidated);
				default:
					return callback(errors.BadArgument);
			}
		});
	}

	_fetchProducts(appid, cb) {
		return this.coll('productDefinition').findOne({ appid }, { projection: { products: 1 } }, (err, result) => {
			if (err != null) { return cb(err); }
			return cb(null, (result != null ? result.products : undefined) || []);
		});
	}

	_findPurchase(game, user_id, storeTransactionId, cb) {
		return this.coll('domains').findOne({ domain: privateDomain(game), user_id }, (err, domain) => {
			if (err != null) { return cb(err); }

			const getPurchase = function () {
				if (domain != null) {
					for (let p of Array.from((domain.purchases || []))) { if (p.storeTransactionId === storeTransactionId) { return p; } }
				}
				return null;
			};
			return cb(null, getPurchase());
		});
	}

	_hasProductDuplicate(toInsert, products) {
		return ((() => {
			const result = [];
			for (let p of Array.from(products)) {
				if (((toInsert.productId != null) && (p.productId === toInsert.productId)) ||
					((toInsert.appStoreId != null) && (p.appStoreId === toInsert.appStoreId)) ||
					((toInsert.googlePlayId != null) && (p.googlePlayId === toInsert.googlePlayId))) {
					result.push(p);
				}
			}
			return result;
		})()).length > 0;
	}

	// Callback: (err, storeType, product, transactionId, storeResponseJson)
	_validateAppStoreReceipt(game, user_id, storeType, product, receipt, cb) {
		const payment =
			{ receipt };

		return this.IAP.verifyPayment('apple', payment, (error, response) => {
			if (error != null) {
				switch (error.status) {
					case 21000: case 21002: case 21003: case 21004: case 21006: return cb(new errors.PurchaseNotConfirmed(2, "Error checking the purchase: " + JSON.stringify(error))); break;
					case 21007: case 21008: return cb(new errors.ExternalStoreEnvironmentError(error.status)); break;
					default: return cb(new errors.ExternalServerTempError(error.status));
				}
			}

			const expectedProduct = (() => {
				switch (storeType) {
					case "appstore": return product.appStoreId;
					case "macstore": return product.macStoreId;
				}
			})();
			const appleProduct = _.filter(response.receipt != null ? response.receipt.in_app : undefined, each => each.product_id === expectedProduct);
			if (appleProduct.length > 0) {
				return cb(null, product, appleProduct[0].transaction_id, response);
			} else {
				return cb(new errors.PurchaseNotConfirmed(1, "Product not purchased"));
			}
		});
	}

	// Callback: (err, storeType, product, transactionId, storeResponseJson)
	_validateGooglePlayReceipt(game, user_id, product, receipt, cb) {
		return this.xtralifeApi.game.getGoogleCerts(game.appid, (err, certs) => {
			let receiptObject;
			if (err != null) { return cb(err != null); }

			if (!certs.packageID) {
				return cb(new errors.PurchaseNotConfirmed(5, "Package ID not configured in the configuration file"));
			}

			if(!certs.serviceAccount) {
				return cb(new errors.PurchaseNotConfirmed(5, "Google Service Account not configured in the configuration file"));
			}

			try {
				receiptObject = JSON.parse(receipt);
			} catch (error1) {
				err = error1;
				return errors.PurchaseNotConfirmed(1, "Invalid receipt (unparsable)");
			}

			if (product.googlePlayId !== 'android.test.purchased') {
				const payment = {
					receipt: receiptObject.purchaseToken,
					productId: product.googlePlayId,
					packageName: certs.packageID,
					keyObject: certs.serviceAccount
				};

				return this.IAP.verifyPayment('google', payment, (error, response) => {
					if (error != null) { return cb(new errors.PurchaseNotConfirmed(2, "Error checking the purchase: " + JSON.stringify(error))); }
					return cb(null, product, response.transactionId, response);
				});
			} else {
				// Android.test.purchased item, skip many checks
				if (receiptObject.productId !== product.googlePlayId) { return cb(new errors.PurchaseNotConfirmed(4)); }
				return cb(null, product, receiptObject.orderId + new ObjectId());
			}
		});
	}
}

module.exports = new StoreAPI();
