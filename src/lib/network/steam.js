const superagent = require("superagent");

//call steam verify token to get the steam id
const validToken = (token, webApiKey, steamAppId, cb) => {
  let endpoint =
  "https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?";

  endpoint += `key=${webApiKey}`;
  endpoint += `&appid=${steamAppId}`;
  endpoint += `&ticket=${token}`;

  console.log('endpoint:', endpoint)

  return superagent
    .get(endpoint)
    .accept("json")
    .set("Accept-Encoding", "gzip, deflate")
    .set("Content-Type", "application/json;charset=UTF-8")
    .end((err, res) => {
      if (err != null) {
        console.log("err:", err.message);
        err.source = "steam";
        return cb(err, null);
      }
      let user = res.body;
      console.log("user:", user);

      cb(null, user);
    });
};

module.exports.validToken = validToken;
