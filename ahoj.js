const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const colors = require('colors/safe');
const httpProxy = require('http-proxy');
const { exec } = require('child_process');


colors.enable();

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer();

const port = 80;

const MAX_CONNECTIONS_PER_IP = 8;
const BLOCK_DURATION = 2 * 60 * 1000;
const blockedIPs = new Map();
const blockedFile = path.join(__dirname, 'blocked.txt');
const logsFile = path.join(__dirname, 'logs.txt');

// Custom rate limiter
const requestCounts = {};
const requestResetInterval = 1000; // Reset counts every second

let connections = 0;
let blockedconnections = 0;
let uniqueIPs = new Map();

// Function to log blocking events to the logs.txt file
const logBlockedIP = (ip, reason) => {
  const logMessage = `[Blocked IP] ${ip} - ${reason}`;
  //console.log(`[Sensor ( INFO )] » ${colors.red(logMessage)}`);
  fs.appendFile(logsFile, `${logMessage}\n`, (err) => {
    if (err) {
      console.error('Error writing to logs.txt:', err);
    }
  });

  // Write blocked IP to the blocked.txt file
  fs.appendFile(blockedFile, `${ip}\n`, (err) => {
    if (err) {
      console.error('Error writing to blocked.txt:', err);
    }
  });

  // Block IP using iptables (only on ports 80 and 443)
  exec(`iptables -A INPUT -s ${ip} -p tcp --sport 80 --dport 80 -j DROP && iptables -A INPUT -s ${ip} -p tcp --sport 443 --dport 443 -j DROP`, (err, stdout, stderr) => {
    if (err) {
      console.error('Error blocking IP with iptables:', err);
    }
  });
};

// Read blocked IPs from file on startup
fs.readFile(blockedFile, 'utf8', (err, data) => {
  if (!err) {
    const lines = data.split('\n');
    lines.forEach((ip) => {
      if (ip.trim() !== '') {
        blockedIPs.set(ip.trim(), Date.now() + BLOCK_DURATION);
      }
    });
  }
});

app.use((req, res, next) => {
  const ip = req.ip;

  // Check if the IP is blocked
  if (blockedIPs.has(ip) && Date.now() < blockedIPs.get(ip)) {
    blockedconnections++;
    //console.log(`[Sensor ( INFO )] » Blocked IP ${colors.red(ip)}`);
    res.destroy(); // Close the connection
    return;
  }

  // Custom rate limiting
  const currentTimestamp = Date.now();
  const currentConnections = requestCounts[ip] || 0;

  if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
    logBlockedIP(ip, 'Excessive connections');
    blockedIPs.set(ip, currentTimestamp + BLOCK_DURATION);
    res.destroy(); // Close the connection
    return;
  }

  requestCounts[ip] = currentConnections + 1;

  // Increment the total connections count
  connections++;

  // Increment the connection count for the IP
  uniqueIPs.set(ip, currentConnections + 1);

  next();
});

app.get('/', (req, res) => {
  res.send('Lol you got mitigated by a shitty antiddos layer7 LOLLLSKSKSKSKSKKS!');
});

// Proxy middleware for forwarding requests
app.use('/proxy-endpoint', (req, res, next) => {
  const ip = req.ip;

  // Check if the IP is blocked
  if (blockedIPs.has(ip) && Date.now() < blockedIPs.get(ip)) {
    blockedconnections++;
    //console.log(`[Sensor ( INFO )] » Blocked IP ${colors.red(ip)}`);
    res.destroy(); // Close the connection
    return;
  }

  // Custom rate limiting for the proxy endpoint
  const currentTimestamp = Date.now();
  const currentConnections = requestCounts[ip] || 0;

  if (currentConnections >= MAX_CONNECTIONS_PER_IP) {
    logBlockedIP(ip, 'Excessive connections');
    blockedIPs.set(ip, currentTimestamp + BLOCK_DURATION);
    res.destroy(); // Close the connection
    return;
  }

  requestCounts[ip] = currentConnections + 1;

  // Forward the request to the target URL
  const target = 'https://qplay.cz';
  proxy.web(req, res, { target });
});

// Handle proxy errors
proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err);
  res.status(500).send('Proxy Error');
});

server.listen(port, () => {
  console.log(`Proxy server is running on http://localhost:${port}`);
});

setInterval(() => {
  let pica = connections + blockedconnections;
  console.log(`[Sensor ( INFO )] » ${colors.white('Accepted Connections')} ${colors.green(connections)} | IP Addresses per second ${colors.blue(uniqueIPs.size)} | Blocked IPs ${colors.red(blockedIPs.size)} | Blocked Connections ${colors.red(blockedconnections)} | Total connections ${colors.yellow(pica)}`);
  connections = 0;
  blockedconnections = 0;
  uniqueIPs.clear();
}, 1000);

setInterval(() => {
  // Reset the request counts every second
  for (const ip in requestCounts) {
    requestCounts[ip] = 0;
  }
}, requestResetInterval);
