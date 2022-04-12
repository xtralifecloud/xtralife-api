const superagent = require("superagent");
const {SteamError} = require("../../errors");

//call steam verify token to get the steam id
const validToken = (token, webApiKey, appId, cb) => {
  let endpoint =
  "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?";

  endpoint += `key=${webApiKey}`;
  endpoint += `&appid=${appId}`;
  endpoint += `&ticket=${token}`;

  return superagent
    .get(endpoint)
    .accept("json")
    .set("Accept-Encoding", "gzip, deflate")
    .set("Content-Type", "application/json;charset=UTF-8")
    .end((err, res) => {
      if (err != null) {
        return cb(new SteamError(err.message), null);
      }
      if("params" in res.body.response && "result" in res.body.response.params) {
        const resParams = res.body.response.params;
        if(resParams.result == "OK" && resParams.vacbanned == false)
          return cb(null, resParams);
      }else if("error" in res.body.response) {
        const message = res.body.response.error?.errordesc;
        const details = res.body.response.error;
        if (details) delete details.errordesc;
        return cb(new SteamError(message, details), null);
      }
    });
};

module.exports.validToken = validToken;
