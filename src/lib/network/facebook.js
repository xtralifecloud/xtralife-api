/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */

const _ = require("underscore");
const graph = require('fbgraph');
const superagent = require("superagent")

/*
validToken = (token, callback)->
	graph.setAccessToken token
	graph.setVersion "2.5"
	graph.get "me?fields=token_for_business", (error, business)->
		graph.get "me?fields=email,id,token_for_businesslast_name,first_name,third_party_id,name,locale,picture{url}", (err, res)->
			if err?
				err.source = "facebook"
			if res?
				res.avatar = res.picture.data.url if res.picture?.data?.url?
				if business?.token_for_business?
					res.id = business.token_for_business 
				else
					res.noBusinessManager = true
			callback err, res
*/

const validToken = (token, useBusinessManager = false, callback) => {

	let endpoint = "https://graph.facebook.com/v13.0/me?";
	let fields = "email,id,last_name,first_name,name,locale,picture{url}";

	if(useBusinessManager) fields += ",token_for_business";
	endpoint += `fields=${fields}`;
	endpoint += `&access_token=${token}`;

	return superagent
		.get(endpoint)
		.accept('json')
		.set('Accept-Encoding', 'gzip, deflate')
		.set('Content-Type', 'application/json;charset=UTF-8')
		.end((err, res) => {
			if(err != null) {
				const status = err.status
				err = res.body.error
				err.source = "facebook"
				err.status = status
				return callback(err, null)
			}
			
			let user = res.body;
			if (user != null && user != {}){
				if(useBusinessManager) user.id = user.token_for_business;
				if (__guard__(user.picture != null ? user.picture.data : undefined, x => x.url) != null) { user.avatar = user.picture.data.url; }
			}
			callback(null, user);
		})
	
	/* 
	graph.setAccessToken(token);
	graph.setVersion("2.5");
	return graph.get(`me?fields=token_for_business,${FIELDS}`, function (error, business) {
		if ((business != null ? business.token_for_business : undefined) != null) {
			business.id = business.token_for_business;
			if (__guard__(business.picture != null ? business.picture.data : undefined, x => x.url) != null) { business.avatar = business.picture.data.url; }
			return callback(error, business);
		} else {
			graph.setAccessToken(token);
			graph.setVersion("2.5");
			return graph.get(`me?fields=${FIELDS}`, function (err, res) {
				if (err != null) {
					err.source = "facebook";
				}
				if (res != null) {
					if (__guard__(res.picture != null ? res.picture.data : undefined, x1 => x1.url) != null) { res.avatar = res.picture.data.url; }
					res.noBusinessManager = true;
				}
				return callback(err, res);
			});
		}
	});
	 */
};

const validFriendsIDs = function (friends, options, callback) {
	graph.setAccessToken(options != null ? options.facebookAppToken : undefined);
	graph.setVersion("2.5");
	let ids = Object.keys(friends);
	const listids = ids.join(",");
	return graph.get(`?ids=${listids}&fields=token_for_business`, function (error, business) {
		if (error != null) { return callback(null, friends); }
		if (business == null) { return callback(null, friends); }
		ids = _.map(business, function (f) {
			friends[f.id].token_for_business = f.token_for_business;
			return friends[f.id];
		});
		friends = _.indexBy(ids, "token_for_business");
		return callback(error, friends);
	});
};

module.exports.validToken = validToken;
module.exports.validFriendsIDs = validFriendsIDs;

function __guard__(value, transform) {
	return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}