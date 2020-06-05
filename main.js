// Response for Uptime Robot
const http = require('http');
http.createServer(function(request, response){
	response.writeHead(200, {'Content-Type': 'text/plain'});
	response.end('Discord bot is active now \n');
}).listen(3000);

// Discord bot implements
const discord = require('discord.js');
const client = new discord.Client();
let userTimesMap = new Map();
// DB接続
const AWS = require('aws-sdk')
const RDS = new AWS.RDSDataService({
    region: "us-west-2",
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY
});

let params = {
  resourceArn: process.env.RESOURCE_ARN,
  secretArn: process.env.SECRET_ARN,
  database: process.env.DATABASE
}

client.on('ready', message => {
	console.log('bot is ready!');
});

// ======================
// メンション時処理
// ======================
client.on('message', message => {
	if(message.isMemberMentioned(client.user)){
    let today = new Date()
    let yesterday = new Date()
    let guildId = message.channel.guild.id
    // 日本時間に設定
    today.setTime(today.getTime() + 1000*60*60*9);
    yesterday.setTime(today.getTime() - 1000*60*60*15);
    let strToday = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDay()
    let strYesterday = yesterday.getFullYear() + "-" + (yesterday.getMonth() + 1) + "-" + yesterday.getDay()
    params.sql = "select users.username ,cast(min(staytimes.joinedtime) As time) As '出社時間',cast(max(staytimes.joinedtime  + staytimes.staytime) As time) As '退社時間' , sec_to_time(sum( time_to_sec(staytimes.staytime))) AS '合計滞在時間' from staytimes " +
                 "LEFT JOIN users ON users.id = staytimes.user_id " + 
                 "where staytimes.joinedtime between '"+ strYesterday +" 05:00:00' and '"+ strToday +" 04:59:59' and staytimes.guild_id = '"+ guildId +"' "+
                 "group by staytimes.guild_id,staytimes.user_id " + 
                 "order by staytimes.user_id,sec_to_time(sum( time_to_sec(staytimes.staytime)));"
    console.log(params.sql)
    let result = new Promise((resolve, reject) => {
        RDS.executeStatement(params, (err, data) => {
        if (err) {
          console.error(err, err.stack);
        } else {
          if (data.records !== undefined){
            let worktimeMsg = "\n" + (yesterday.getMonth() + 1) + "月" + yesterday.getDay() + "日の稼働状況です。\n";
            data.records.forEach( item => {
              worktimeMsg = worktimeMsg + "【" + item[0].stringValue + "】\n"
              worktimeMsg = worktimeMsg + "勤務時間：" + item[1].stringValue + "〜" + item[2].stringValue + "\n"
              worktimeMsg = worktimeMsg + "稼働時間：" + item[3].stringValue + "\n\n"
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
client.on('voiceStateUpdate', (oldmember, newmember)=>{ 
  console.log(userTimesMap)
  const newUserId = newmember.user.id
  // ミュートの変更は除外する
  if(oldmember.selfMute != newmember.selfMute){
    return;
  }
  // 切断時は除外する
  console.log(newmember.voiceChannel)
  if(newmember.voiceChannel !== undefined ){
    const newChannelName = newmember.voiceChannel.name;
    const newChannelId = newmember.voiceChannel.id;
    const guildId = newmember.voiceChannel.guild.id
    let datetime = new Date()
    datetime.setTime(datetime.getTime() + 1000*60*60*9);
    datetime = datetime.getFullYear() + "-" + (datetime.getMonth() + 1) + "-" + datetime.getDay() + " "+
               datetime.getHours() + ":" + datetime.getMinutes() + ":" + datetime.getSeconds()
    params.sql = "INSERT INTO staytimes (user_id, guild_id,channel_id,channel_name,joinedtime,status) "+
                 "VALUES ('" + newUserId + "', '" + guildId + "','" + newChannelId + "','" + newChannelName + "','"+ datetime +"','1')";
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
  // 新規接続
  let username = newmember.user.username;
  if(oldmember.voiceChannel === undefined){
    // 初回のチャンネル選択
    userTimesMap.set(username, new Date());
    return;
  }
  let oldChannelName = oldmember.voiceChannel.name;
  let oldChannelId = oldmember.voiceChannel.id;
  // 滞在時間を計算
  if(userTimesMap.get(username)) {
    // 2回目以降のチャンネル選択
    let nowTime = new Date();
    let diffTime = new Date(nowTime - userTimesMap.get(username))
    userTimesMap.set(username, new Date());
    let staytime = diffTime.getHours() + ":" + diffTime.getMinutes() + ":" + diffTime.getSeconds()
    // 滞在時間 UPDATE
    params.sql = "UPDATE staytimes SET staytime = '"+ staytime +"' ,status = '2'" +
                   " WHERE status = '1' and user_id = '" + newUserId + "' and channel_id = '" + oldChannelId + "'";
    let result = new Promise((resolve, reject) => {
      RDS.executeStatement(params, (err, data) => {
        if (err) {
          console.error(err, err.stack);
        } else {
          resolve(data);
        }
      });
    });
  } else {
    // 初回のチャンネル選択
    userTimesMap.set(username, new Date());
  }
});

if(process.env.DISCORD_BOT_TOKEN == undefined){
	console.log('please set ENV: DISCORD_BOT_TOKEN');
	process.exit(0);
}
client.login( process.env.DISCORD_BOT_TOKEN );