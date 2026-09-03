# Avalon Multiplay

浏览器多人阿瓦隆。项目是纯静态页面，不需要 Firebase、腾讯云或自建数据库；联机通过公共 MQTT WebSocket Broker 转发房间消息，由房主浏览器串行处理游戏状态。

## 本地运行

在项目目录启动任意静态文件服务器，例如：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

然后打开 <http://127.0.0.1:8000/>。同一房间的玩家必须选择同一个联机服务器。

## 公共联机服务器

默认服务器：

```text
wss://broker.emqx.io:8084/mqtt
```

界面也可以切换到 `broker-cn.emqx.io`、HiveMQ 或 Mosquitto 测试服务器。配置位于 `js/mqtt-config.js`。

应用层会为玩家指令和房间快照签名，身份、夜间信息与任务牌使用每位玩家的独立密钥加密；普通玩家不能再直接篡改整局状态。

公共 Broker 仍只适合朋友间临时游玩和测试：它不保证服务可用性，也没有服务端房间 ACL。首次接触某个房间时仍需要信任 Broker 返回的首个有效快照，房主浏览器也是本局的可信权威。不要在昵称或房间里放敏感信息。对局中原房主掉线时，由于新房主不持有旧房主的秘密分配，本局会安全中止而不是泄露身份后继续。

## 测试

```powershell
node --test tests\game-rules.test.js tests\ui-safety.test.js tests\mqtt-database.test.js
```

测试覆盖标准任务规则、9/10 人角色分布、中立角色胜利、放逐轮次、连续否决、昵称转义、MQTT 多客户端同步、并发动作重试、权限验证、私密消息加密、房主掉线接任及保留房间清理。
