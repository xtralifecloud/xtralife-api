const superagent = require("superagent");

//call steam verify token to get the steam id
const validToken = (token, webApiKey, appId, cb) => {
  let endpoint =
  "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?";

  endpoint += `key=${webApiKey}`;
  endpoint += `&appid=${appId}`;
  endpoint += `&ticket=${token}`;

  console.log('endpoint:', endpoint)

  return superagent
    .get(endpoint)
    .accept("json")
    .set("Accept-Encoding", "gzip, deflate")
    .set("Content-Type", "application/json;charset=UTF-8")
    .end((err, res) => {
      if (err != null) {
        err.source = "steam";
        return cb(err, null);
      }
      if("params" in res.body.response && "result" in res.body.response.params) {
        const resParams = res.body.response.params;
        if(resParams.result == "OK" && resParams.vacbanned == false)
          return cb(null, resParams);
      }else if("error" in res.body.response) {
        err = {}
        err.source = "steam";
        err.message = res.body.response.error.errordesc;
        return cb(err, null);
      }
      return cb(new Error("Steam API returned an unknown response"), null);
    });
};

module.exports.validToken = validToken;
