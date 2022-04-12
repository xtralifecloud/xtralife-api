/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
const {OAuth2Client} = require('google-auth-library');
const {GoogleError} = require('../../errors');

const validToken = function (token, clientID, cb) {
	const client = new OAuth2Client(clientID);
	async function verify() {
	const ticket = await client.verifyIdToken({
		idToken: token,
		audience: clientID
	});
	return cb(null, ticket.getPayload());
	}
	verify().catch(err => {
		if(err.message.includes(":")) err.message = err.message.split(":")[0]
		cb(new GoogleError(err.message))
	 });

/*  const options = {
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
	}); */
};

module.exports.validToken = validToken;