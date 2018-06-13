		
_ = require "underscore"
graph = require 'fbgraph'

###
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
###

FIELDS = "email,id,last_name,first_name,third_party_id,name,locale,picture{url}"

validToken = (token, callback)->
	graph.setAccessToken token
	graph.setVersion "2.5"
	graph.get "me?fields=token_for_business,#{FIELDS}", (error, business)->
		if business?.token_for_business?
			business.id = business.token_for_business 
			business.avatar = business.picture.data.url if business.picture?.data?.url?
			callback error, business
		else
			graph.setAccessToken token
			graph.setVersion "2.5"
			graph.get "me?fields=#{FIELDS}", (err, res)->
				if err?
					err.source = "facebook"
				if res?
					res.avatar = res.picture.data.url if res.picture?.data?.url?
					res.noBusinessManager = true
				callback err, res

validFriendsIDs = (friends, options, callback)->
	graph.setAccessToken options?.facebookAppToken
	graph.setVersion "2.5"
	ids = Object.keys(friends)
	listids = ids.join(",")
	graph.get "?ids=#{listids}&fields=token_for_business", (error, business)->
		return callback null, friends if error?
		return callback null, friends unless business?
		ids = _.map business, (f)->
			friends[f.id].token_for_business = f.token_for_business
			return friends[f.id]
		friends = _.indexBy ids, "token_for_business"
		callback error, friends

module.exports.validToken = validToken
module.exports.validFriendsIDs = validFriendsIDs
