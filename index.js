import {
  Audio,
  PeerConnection,
  RtcpReceivingSession,
  Video,
  initLogger,
} from "node-datachannel";
import WebSocket from "ws";

initLogger("Debug");

const { PEERS, URL } = process.env;

class Client {
  constructor() {
    this.ws = this.createWs();
  }

  send(data) {
    this.ws.send(JSON.stringify(data));
  }

  createWs() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
    }

    const ws = new WebSocket(URL);
    ws.on("open", () => {
      this.connect();
    });

    ws.on("close", () => {});

    let timer = 0;
    ws.on("message", (msg, isBinary) => {
      if (isBinary) return;

      try {
        const data = JSON.parse(msg.toString("utf-8"));
        if (data.error) {
          console.error("[ws:err]", data);
          clearTimeout(timer);
          timer = setTimeout(() => {
            this.connect();
          }, 1000);
          return;
        }

        if (data.command === "offer") {
          clearTimeout(timer);
          console.log("[ws:offer]", { ...data, sdp: undefined });
          this.onOffer(data);
          return;
        }

        console.log("[ws:msg]", data);
      } catch (error) {
        return;
      }
    });

    return ws;
  }

  onOffer(data) {
    if (this.peer) {
      this.peer.close();
    }
    this.peer = new PeerConnection(data.id.toString(), { iceServers: [] });

    this.peer.onLocalDescription((sdp, type) => {
      if (type === "answer") {
        this.send({
          command: "answer",
          id: data.id,
          peer_id: data.peer_id,
          sdp: { sdp, type },
        });
      }
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
      console.log("[peer:state]", data.id.toString(), state);
      this.state = state;
      if (state === "closed") {
        this.connect();
        this.peer.close();
      }
    });

    this.peer.setRemoteDescription(data.sdp.sdp, data.sdp.type);

    const session = new RtcpReceivingSession();
    const audio = new Audio("audio", "RecvOnly");
    audio.addOpusCodec(110);
    audio.setBitrate(128);
    const audioTrack = this.peer.addTrack(audio);
    audioTrack.setMediaHandler(session);

    const video = new Video("video", "RecvOnly");
    video.addH264Codec(98);
    video.setBitrate(3000);
    const videoTrack = this.peer.addTrack(video);
    videoTrack.setMediaHandler(session);

    this.peer.setLocalDescription();

    data.candidates.forEach(({ candidate }) => {
      this.peer.addRemoteCandidate(candidate, "\0");
    });
  }

  connect() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.ws = this.createWs();
    }

    return this.send({ command: "request_offer" });
  }
}

const clients = [];
for (let i = 0; i < +(PEERS || 1); i++) {
  clients.push(new Client());
}

// setInterval(() => {
//   const stats = {};

//   clients.forEach((client) => {
//     const stat = client.state || "unknown";
//     stats[stat] = (stats[stat] || 0) + 1;
//   });

//   console.table([stats]);
// }, 5000);
