import WebSocket from "ws";
import {
  Audio,
  Video,
  initLogger,
  PeerConnection,
  RtcpReceivingSession,
} from "node-datachannel";

initLogger("Debug");

const { PEERS, URL } = process.env;

class Client {
  constructor() {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      this.send({ command: "request_offer" });
    });

    ws.on("message", (msg, isBinary) => {
      if (isBinary) return;

      try {
        const data = JSON.parse(msg.toString("utf-8"));
        if (data.error) {
          console.error("[ws:err]", data);
          this.send({ command: "request_offer" });
          return;
        }

        if (data.command === "offer") {
          console.log("[ws:offer]", { ...data, sdp: undefined });
          this.onOffer(data);
          return;
        }

        console.log("[ws:msg]", data);
      } catch (error) {
        return;
      }
    });

    this.ws = ws;
  }

  send(data) {
    this.ws.send(JSON.stringify(data));
  }

  onOffer(data) {
    this.peer = new PeerConnection(data.id.toString(), { iceServers: [] });

    this.peer.onLocalDescription((sdp, type) => {
      if (type !== "answer") return;

      this.send({
        command: "answer",
        id: data.id,
        peer_id: data.peer_id,
        sdp: { sdp, type },
      });
    });

    this.peer.onLocalCandidate((candidate, mid) => {
      this.send({
        command: "candidate",
        id: data.id,
        peer_id: data.peer_id,
        sdp: this.peer.localDescription(),
        candidates: [{ candidate: candidate.replace("a=", ""), mid }],
      });
    });

    this.peer.onStateChange((state) => {
      this.state = state;
      console.log("[peer:state]", data.id.toString(), state);
    });

    this.tracks = [];
    this.peer.onTrack((track) => {
      const type = track.type();
      this.tracks.push(track); // keep tracks to avoid garbage collection
      track.onMessage((msg) => {
        console.log(data.id.toString(), type, msg.length);
        msg = null
      });
    });

    this.peer.setRemoteDescription(data.sdp.sdp, data.sdp.type);

    this.peer.setLocalDescription();

    data.candidates.forEach(({ candidate }) => {
      this.peer.addRemoteCandidate(candidate, "\0");
    });
  }
}

const clients = [];
for (let i = 0; i < +(PEERS || 1); i++) {
  clients.push(new Client());
}

setInterval(() => {
  const stats = {};
  clients.forEach((client) => {
    stats[client.state] = (stats[client.state] || 0) + 1;
  });
  console.table([stats]);
}, 10000);
