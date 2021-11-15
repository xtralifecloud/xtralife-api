/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const api = require("../api.js");
const AbstractAPI = require("../AbstractAPI.js");
const errors = require("../errors.js");
const {
	ObjectId
} = require('mongodb');

const Promise = require('bluebird');

class IndexAPI extends AbstractAPI {
	constructor() {
		super();
		this.elastic = null;
	}

	configure(parent, callback) {

		this.parent = parent;
		return xlenv.inject(["=elastic"], (err, elastic) => {

			this.elastic = elastic;
			logger.info("ES Index initialized");

			return callback(err, {});
		});
	}

	index(context, domain, indexName, objectId, properties, contents) {

		const document = properties;

		document.payload = contents;

		return this.handleHook("before-index", context, domain, {
			domain,
			user_id: context.gamer_id,
			gamer_id: context.gamer_id,
			indexName,
			objectId,
			properties,
			contents
		}).then(() => {
			return this.elastic.index({
				index: domain.toLowerCase(),
				type: indexName,
				id: objectId,
				body: document,
				refresh: true
			});
		});
	}

	get(context, domain, indexName, objectId) {

		return this.handleHook("before-index-get", context, domain, {
			domain,
			user_id: context.gamer_id,
			gamer_id: context.gamer_id,
			indexName,
			objectId
		}).then(() => {
			return this.elastic.get({
				index: domain.toLowerCase(),
				type: indexName,
				id: objectId
			});
		});
	}

	// q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
	// sort: ['field1', 'field2']
	search(context, domain, indexName, q, sort, from, max, search_type) {
		if (search_type == null) { search_type = 'query_then_fetch'; }
		return this.handleHook("before-index-search", context, domain, {
			domain,
			user_id: context.gamer_id,
			gamer_id: context.gamer_id,
			indexName,
			q,
			sort,
			from,
			max
		}).then(() => {
			return this.elastic.search({
				index: domain.toLowerCase(),
				type: indexName,
				q,
				defaultOperator: 'AND',
				sort,
				from,
				size: max,
				search_type
			});
		});
	}

	// query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
	query(context, domain, indexName, query, from, max, search_type) {
		if (search_type == null) { search_type = 'query_then_fetch'; }
		return this.handleHook("before-index-query", context, domain, {
			domain,
			user_id: context.gamer_id,
			gamer_id: context.gamer_id,
			indexName,
			query,
			from,
			max
		}).then(() => {
			return this.elastic.search({
				index: domain.toLowerCase(),
				type: indexName,
				body: query,
				from,
				size: max,
				search_type
			});
		});
	}

	delete(context, domain, indexName, objectId) {
		return this.handleHook("before-index-delete", context, domain, {
			domain,
			user_id: context.gamer_id,
			gamer_id: context.gamer_id,
			indexName,
			objectId
		}).then(() => {
			return this.elastic.delete({
				index: domain.toLowerCase(),
				type: indexName,
				id: objectId
			});
		});
	}

	sandbox(context) {
		return {
			index: (domain, indexName, objectId, properties, payload) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.index(context, domain, indexName, objectId, properties, payload);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			get: (domain, indexName, objectId) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.get(context, domain, indexName, objectId);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			// q : http://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html
			// sort: ['field1', 'field2']
			search: (domain, indexName, q, sort, from, max, search_type) => {
				if (sort == null) { sort = []; }
				if (from == null) { from = 0; }
				if (max == null) { max = 10; }
				if (search_type == null) { search_type = 'query_then_fetch'; }
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.search(context, domain, indexName, q, sort, from, max, search_type);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			// query : https://www.elastic.co/guide/en/elasticsearch/guide/current/full-body-search.html
			query: (domain, indexName, query, from, max, search_type) => {
				if (from == null) { from = 0; }
				if (max == null) { max = 10; }
				if (search_type == null) { search_type = 'query_then_fetch'; }
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.query(context, domain, indexName, query, from, max, search_type);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			delete: (domain, indexName, objectId) => {
				if (this.parent.game.checkDomainSync(context.game.appid, domain)) {
					return this.delete(context, domain, indexName, objectId);
				} else {
					throw new errors.BadArgument("Your game doesn't have access to this domain");
				}
			},

			getClient: () => { // OpenSource version ONLY, not available in the hosted edition
				return this.elastic;
			}
		};
	}
}

module.exports = new IndexAPI();
