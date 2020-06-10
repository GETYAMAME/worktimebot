// Response for Uptime Robot
const http = require("http");
http
  .createServer(function(request, response) {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("Discord bot is active now \n");
  })
  .listen(3000);

// Discord bot implements
const discord = require("discord.js");
const client = new discord.Client();
let userTimesMap = new Map();


// DB接続
const AWS = require("aws-sdk");
const RDS = new AWS.RDSDataService({
  region: "us-west-2",
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY
});

let params = {
  resourceArn: process.env.RESOURCE_ARN,
  secretArn: process.env.SECRET_ARN,
  database: process.env.DATABASE
};

// 定数
const CONST_DISCONNECT = 0
const CONST_CONNECT = 1
const CONST_CHANNEL_CHANGE = 2
const CONST_MUTE = 3


client.on("ready", message => {
  console.log("bot is ready!");
});

// ======================
// メンション時処理
// ======================
client.on("message", message => {
  if (message.isMemberMentioned(client.user)) {
    let today = new Date();
    let guildId = message.channel.guild.id;
    // 日本時間に設定
    today.setTime(today.getTime() + 1000 * 60 * 60 * 9);
    //let yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    let strToday = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate();
    //let strYesterday = yesterday.getFullYear() + "-" + (yesterday.getMonth() + 1) + "-" + yesterday.getDate();   
    params.sql =
      "select users.username ,cast(min(staytimes.joinedtime) As time) As '出社時間',max(sec_to_time(time_to_sec(staytimes.joinedtime) + time_to_sec(staytimes.staytime))) As '退社時間' , sec_to_time(sum( time_to_sec(staytimes.staytime))) AS '合計滞在時間' from staytimes " +
      "LEFT JOIN users ON users.id = staytimes.user_id " +
      "where staytimes.joinedtime between '" +
      strToday +
      " 00:00:00' and '" +
      strToday +
      " 23:59:59' and staytimes.guild_id = '" +
      guildId +
      "' " +
      "group by staytimes.guild_id,staytimes.user_id " +
      "order by staytimes.user_id,sec_to_time(sum( time_to_sec(staytimes.staytime)));";
    console.log(params.sql)
    let result = new Promise((resolve, reject) => {
      RDS.executeStatement(params, (err, data) => {
        if (err) {
          console.error(err, err.stack);
        } else {
          if (data.records !== undefined) {
            let worktimeMsg = "\n" + (today.getMonth() + 1) + "月" + today.getDate() + "日の稼働状況です。\n";
            data.records.forEach(item => {
              worktimeMsg = worktimeMsg + "【" + item[0].stringValue + "】\n";
              worktimeMsg = worktimeMsg + "勤務時間：" + item[1].stringValue + "〜" + item[2].stringValue + "\n";
              worktimeMsg = worktimeMsg + "稼働時間：" + item[3].stringValue + "\n\n";
            });
            message.reply(worktimeMsg);
          }
          resolve(data);
        }
      });
    });
    return;
  }
});

// ======================
// ボイスチャットの移動時処理
// ======================
client.on("voiceStateUpdate", (oldmember, newmember) => {
  console.log(userTimesMap);
  // Discordの状態を判定
  let status = null
  if(newmember.voiceChannel === undefined) {
    // 0:切断
    status = 0
  } else if (oldmember.voiceChannel === undefined) {
    // 1:接続
    status = 1
  } else if (oldmember.selfMute != newmember.selfMute) {
    // 3:ミュート設定変更
    status = 3
    console.log("3:ミュート設定変更　処理終了")
    return;
  } else {
    // 2:継続（チャンネル移動）
    status = 2
  }
  console.log(status)
  const newUserId = newmember.user.id;
  // 切断時以外：参加時間（joinedtime）を設定
  if (status !== CONST_DISCONNECT) {
    const newChannelName = newmember.voiceChannel.name;
    const newChannelId = newmember.voiceChannel.id;
    const guildId = newmember.voiceChannel.guild.id;
    let datetime = new Date();
    datetime.setTime(datetime.getTime() + 1000 * 60 * 60 * 9);
    datetime =
      datetime.getFullYear() +
      "-" +
      (datetime.getMonth() + 1) +
      "-" +
      datetime.getDate() +
      " " +
      datetime.getHours() +
      ":" +
      datetime.getMinutes() +
      ":" +
      datetime.getSeconds();
    params.sql =
      "INSERT INTO staytimes (user_id, guild_id,channel_id,channel_name,joinedtime,status) " +
      "VALUES ('" +
      newUserId +
      "', '" +
      guildId +
      "','" +
      newChannelId +
      "','" +
      newChannelName +
      "','" +
      datetime +
      "','1')";
    let result = new Promise((resolve, reject) => {
      RDS.executeStatement(params, (err, data) => {
        if (err) {
          console.error(err, err.stack);
        } else {
          resolve(data);
        }
      });
    });
  }
  let username = newmember.user.username;
  // 接続時
  if (status === CONST_CONNECT) {
    // 初回
    userTimesMap.set(username, new Date());
    return;
  }
  let oldChannelName = oldmember.voiceChannel.name;
  let oldChannelId = oldmember.voiceChannel.id;
  // 切断、チャンネル移動時：経過時間を設定
  if (userTimesMap.get(username)) { 
    let nowTime = new Date();
    let diffTime = new Date(nowTime - userTimesMap.get(username));
    userTimesMap.set(username, new Date());
    let staytime =
      diffTime.getHours() +
      ":" +
      diffTime.getMinutes() +
      ":" +
      diffTime.getSeconds();
    // 滞在時間 UPDATE
    params.sql =
      "UPDATE staytimes SET staytime = '" +
      staytime +
      "' ,status = '2'" +
      " WHERE status = '1' and user_id = '" +
      newUserId +
      "' and channel_id = '" +
      oldChannelId +
      "'";
    let result = new Promise((resolve, reject) => {
      RDS.executeStatement(params, (err, data) => {
        if (err) {
          console.error(err, err.stack);
        } else {
          resolve(data);
        }
      });
    });
  }
});

if (process.env.DISCORD_BOT_TOKEN == undefined) {
  console.log("please set ENV: DISCORD_BOT_TOKEN");
  process.exit(0);
}
client.login(process.env.DISCORD_BOT_TOKEN);
