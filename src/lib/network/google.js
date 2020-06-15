/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const request = require("request");

const validToken = function (token, cb) {
	const options = {
		method: 'GET',
		url: 'https://www.googleapis.com/plus/v1/people/me',
		headers: {
			Authorization: 'Bearer ' + token
		}
	};

	return request(options, function (err, resp, body) {
		let me;
		if (err != null) {
			err.source = "googleapis";
			return cb(err);
		}
		try {
			me = JSON.parse(body);
		} catch (e) {
			return cb(err);
		}

		if (me.error != null) {
			err = me.error;
			err.source = "googleapis";
			me = null;
		}

		return cb(err, me);
	});
};

module.exports.validToken = validToken;