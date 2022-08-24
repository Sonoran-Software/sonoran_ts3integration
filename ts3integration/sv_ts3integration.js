/*
  SonoranCAD FiveM - A SonoranCAD integration for FiveM servers
   Copyright (C) 2020  Sonoran Software

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program in the file "LICENSE".  If not, see <http://www.gnu.org/licenses/>.
*/

const {
    TeamSpeak,
    QueryProtocol
} = require("ts3-nodejs-library");
var ts3config = require("./plugins/ts3integration/config_ts3integration.json");
var clientsToAdd = [];
var clientsToRemove = [];

// cache units - they might get removed before we process them
var UnitCache = new Map();

on('SonoranCAD::pushevents:UnitLogin', function (unit) {
    for (let apiId of unit.data.apiIds) {
        //If not valid API ID; return
        if (!apiId.includes("=")) return;

        clientsToAdd.push(apiId);
        UnitCache.set(unit.id, apiId);
        let i = clientsToRemove.indexOf(apiId);
        if (i > -1) {
            clientsToRemove.splice(i, 1);
        }

    }
});

on('SonoranCAD::pushevents:UnitLogout', function (id) {
    let apiid = UnitCache.get(id);

    if (apiid == undefined) {
        emit("SonoranCAD::core:writeLog", "debug", `TS3 Integration Error: Could not find matching unit: ${id} not found`);
        return;
    }

    clientsToRemove.push(apiid);

    UnitCache.delete(id);
});

//Loops through the array of clientsToAdd and uses the TeamSpeak API to assign a serverGroup
async function addGroupToClients(teamspeak, sGroup) {
    for (let id of clientsToAdd) {
        let client = await teamspeak.getClientByUid(id);

        if (client) {
            await teamspeak.clientAddServerGroup(client, sGroup);
            emit("SonoranCAD::core:writeLog", "debug", "Adding " + client.nickname + " to onduty group " + ts3config.onduty_servergroup);
        } else {
            emit("SonoranCAD::core:writeLog", "warn", "Was unable to locate client with ID " + id);
        }
    }
}


//Checks if the client is in a on duty enforced channel and removes them if so.
async function checkEnforcedChannel(client, teamspeak, channelName) {
    if (ts3config.enforced_channels.includes(channelName)) {
        await teamspeak.clientKick(client, 4, "Went off duty", true);
    } else emit("SonoranCAD::core:writeLog", "debug", `Channel ${channelName} is not in enforced list, which is: ${JSON.stringify(ts3config.enforced_channels)}`);
}

//Loops through the array of clientsToRemove and uses the TeamSpeak API to remove a previously assigned serverGroup
async function removeGroupFromClients(teamspeak, sGroup) {
    for (let id of clientsToRemove) {
        let client = await teamspeak.getClientByUid(id);
        if (client) {
            // get name of channel client is in
            let channel = await teamspeak.getChannelById(client.cid);

            emit("SonoranCAD::core:writeLog", "debug", `Client is in channel ID ${client.cid}, which is named ${channel.name}`);

            await checkEnforcedChannel(client, teamspeak, channel.name);

            await teamspeak.clientDelServerGroup(client, sGroup);

            emit("SonoranCAD::core:writeLog", "debug", "Removing " + client.nickname + " from onduty group " + ts3config.onduty_servergroup);

        } else emit("SonoranCAD::core:writeLog", "warn", "Was unable to locate client with ID " + id);
    }
}

setInterval(async () => {
    //If there are no clients to add or remove then return
    if (!(clientsToAdd.length > 0 || clientsToRemove.length > 0)) return;

    //There are clients to add or remove so therefor we connect to teamspeak
    const teamspeak = await TeamSpeak.connect({
        host: ts3config.ts3server_host,
        queryport: Number(ts3config.ts3server_qport),
        serverport: Number(ts3config.ts3server_port),
        protocol: QueryProtocol.RAW,
        username: ts3config.ts3server_user,
        password: ts3config.ts3server_pass,
        nickname: "SonoranCAD Integration"
    }).catch(e => {
        emit("SonoranCAD::core:writeLog", "error", `TS3 Integration Error: ${e}`);
        clientsToAdd = [];
        clientsToRemove = [];
    });

    //Grab the onduty_servergroup from the teamspeak 3 config
    const sGroup = await teamspeak.getServerGroupByName(ts3config.onduty_servergroup);

    if (!sGroup) {
        emit("SonoranCAD::core:writeLog", "error", "TS3 Integration Error: Unable to locate server group. Ensure onduty_servergroup is set.");
        clientsToAdd = [];
        clientsToRemove = [];
        return;
    }

    await addGroupToClients(teamspeak, sGroup);

    await removeGroupFromClients(teamspeak, sGroup);

    clientsToAdd = [];

    clientsToRemove = [];

    await teamspeak.quit();

}, ts3config.logoutGraceTime)