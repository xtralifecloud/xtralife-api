# xtralife api changelog

## 4.2.6

- change GCM to FCM for android push
- update APN service
- simplify register/unregister device token
- update config (in-app and pushs)
- allow no hook definition
- prevent missing config for AWS
- Disable init for unused module of api in the dashboard

## 4.2.5

- update AWS sdk

## 4.2.4

- fix AWS deleteObject

## 4.2.3

- split matches list result and count for better performance (backoffice)

## 4.2.2

- fix mongo driver done value return for setFriendStatus

## 4.2.1

- add "credentials" key for external login

## 4.2.0 

- add/update login and convert for email, steam, google, firebase, gamecenter, apple, facebook

## 4.1.3

- add configurable redlock timeout via config and/or request params

## 4.1.2

- add business manager option for facebook login
- fix android in app
- rename android in app config key to serviceAccount

## 4.1.1

- fix count returned value virtual VFS
- fix binary data upload for VFS

## 4.1.0

- improve backoffice search method

## 4.0.2

- add semver ^ for xtralife dependencies

## 4.0.1

- add error handling for mongo 11000 error on user register
- add search method in transactions (backoffice)
- split users search result and count for better performance (backoffice)
- remove gamecenter-identity-verifier dependency

## 4.0.0

xtralife-msg: 4.0.0

- update npm dependencies