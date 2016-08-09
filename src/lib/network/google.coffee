request = require "request"

validToken = (token, cb)->
	options =
		method: 'GET'
		url: 'https://www.googleapis.com/plus/v1/people/me'
		headers:
			Authorization: 'Bearer '+token

	request options, (err, resp, body)->
		if err?
			err.source = "googleapis"
			return cb err
		try
			me = JSON.parse body
		catch e
			return cb err

		if me.error?
			err = me.error
			err.source = "googleapis"
			me = null

		cb err, me

module.exports.validToken = validToken