# Broadcasting Tower

[<img src="broadcasting-tower-logo.png" width="350" />](broadcasting-tower-logo.png)

This is a simple broadcasting tower service. You can broadcast messages and query them.

The goal of this service is to facilitate free Internet communication.

Example deployment:
[https://broadcasting-tower.net](https://broadcasting-tower.net)

Such service open for all allows for some very interesting projects where decentralized communication is required. Ideally there should be a network of such towers.

### API v1

**Broadcast message**

`POST /api/v1/broadcast`

You can send a JSON (Header: `Content-Type: application/json`)

```json
{ "messageText": "Hello, World!" }
```

or a form data (Header: `Content-Type: application/x-www-form-urlencoded`)

```
messageText=Hello+World%21
```

Max byte length of "messageText" is 10,000 bytes (assuming "utf-8" encoding).

This broadcasting tower will store max ~1GB of recent messages.

The successful response will have a status of 201 and the response body will contain a message entry, example:

```
1725703790081|Hello, World!
```

A timestamp in milliseconds and a "|" separator in front of the message text.

In case of an error, the response status will be 400 and the response body will contain a string "failure".

**Query messages**

`GET /api/v1/messages`

You can query messages by specifying the following query parameters:

- `startsWith` (optional): Filter messages that start with the specified text.
- `timestampFrom` (optional): Filter messages that have a timestamp greater than or equal to the specified timestamp. (in milliseconds)
- `timestampTo` (optional): Filter messages that have a timestamp less than or equal to the specified timestamp. (in milliseconds)
- `order` (optional): Order messages by timestamp in ascending or descending order. Default is descending. (newest first)
- `limit` (optional): Limit the number of messages to return. Default is 1,000.

Example query:

```
/api/v1/messages?startsWith=message&timestampFrom=1725703790070&timestampTo=1725703790081&order=desc&limit=4
```

Example response (status: 200):

```
1725703790081|message4
1725703790080|message3
1725703790079|message2
1725703790078|message1
```

Each message entry is separated by a newline character with a timestamp in milliseconds and a "|" separator in front of the message text.

Response type headers:

- Content-Type: text/plain
- Transfer-Encoding: chunked

In case of an error, the response status will be 400 and the response body will contain a string "failure".

### Docker Image

This app is available on docker hub as "xfor/broadcasting-tower".

The app accepts some optional env variables:

- PORT (default: 3000)
- MAX_NUMBER_OF_MESSAGES_PER_QUERY (default: 1000)
- MAX_MESSAGE_SIZE_IN_BYTES (default: 10000 => 10kB)
- MAX_CACHE_SIZE_IN_BYTES (default: 1000000000 => 1GB)

### Example deployment

**Server**

I bought the smallest Starter VPS with Ubuntu for ~$3.50 a month at ovh.com (1 vCPU 2 GB RAM 20 GB disk) and selected the data-center in Canada. That should be enough to host this app.

**Domain**

I bought the broadcasting-tower.net at aftermarket.pl for ~$14 a year. Later point DNS servers to cloudflare ones.

**DNS**

I go with free DNS at cloudflare.com.
Configure DNS "A" to your server's ip with CloudFlare proxy.
In CloudFlare create the origin SSL certificate in pem format. Copy the keys and later place them in VPS.
Set SSL/TLS encryption => Current encryption mode to "Full (strict)".

**Container registry**

I use dockerhub. Created a new repository "xfor/broadcasting-tower"

**VPS configuration**

create SSL directory:

```bash
sudo mkdir -p /etc/nginx/ssl
```

paste CloudFlare's certificate public key:

```bash
sudo vim /etc/nginx/ssl/origin.crt
```

paste CloudFlare's certificate private key:

```bash
sudo vim /etc/nginx/ssl/origin.key
```

Clone the repo:

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/michal-wrzosek/broadcasting-tower.git
```

**CI/CD**

Configure github actions secrets:

- DOCKER_USERNAME
- DOCKER_PASSWORD
- SERVER_HOST
- SERVER_USER
- SERVER_PASSWORD

On each push to `main` branch new image will be created and the server will restart with the newest one
