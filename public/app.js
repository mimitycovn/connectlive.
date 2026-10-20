const $ = (id) => document.getElementById(id);

let roomId = null;
let hostToken = null;
let role = null;
let mode = "two-way";
let socket = null;
let peer = null;
let localStream = null;
let pendingOffer = null;
let queuedIce = [];
let joined = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function status(message) {
  const el = $("status");
  if (el) el.textContent = message;
}

function show(id) {
  const el = $(id);
  if (el) el.style.display = "block";
}

function hide(id) {
  const el = $(id);
  if (el) el.style.display = "none";
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function invitationUrl() {
  return `${location.origin}/?room=${encodeURIComponent(roomId)}`;
}

async function createSession(selectedMode) {
  try {
    mode = selectedMode || "two-way";
    status("Creating your session...");

    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not create session.");
    }

    roomId = data.roomId;
    hostToken = data.hostToken;
    role = "host";

    const link = $("inviteLink");
    if (link) {
      link.value = invitationUrl();
      show("inviteArea");
    }

    status("Session created. Share your invitation link.");
    connectSocket();
  } catch (error) {
    status("Error: " + error.message);
  }
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.onopen = () => {
    send({
      type: "join",
      roomId,
      role,
      hostToken
    });
  };

  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "error") {
      status(msg.message);
      return;
    }

    if (msg.type === "joined") {
      joined = true;
      status("Connected to the session server. Waiting for the other person...");
    }

    if (msg.type === "peer-ready") {
      status("The other person has joined. Connecting...");
      if (role === "guest") await makeOffer();
    }

    if (msg.type === "offer" && role === "host") {
      pendingOffer = msg;
      status("The other person is calling. Tap Join to allow camera and microphone.");
    }

    if (msg.type === "answer" && peer) {
      await peer.setRemoteDescription(msg.description);
      await flushIce();
    }

    if (msg.type === "ice" && msg.candidate) {
      if (peer && peer.remoteDescription) {
        try {
          await peer.addIceCandidate(msg.candidate);
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      } else {
        queuedIce.push(msg.candidate);
      }
    }

    if (msg.type === "peer-left") {
      status("The other person has left the session.");
      closePeer();
    }

    if (msg.type === "session-ended") {
      status("This session has ended.");
      closePeer();
      if (socket) socket.close();
    }
  };

  socket.onerror = () => {
    status("Connection error. Please refresh and try again.");
  };

  socket.onclose = () => {
    joined = false;
  };
}

function createPeer() {
  peer = new RTCPeerConnection(rtcConfig);

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      send({
        type: "ice",
        candidate: event.candidate
      });
    }
  };

  peer.ontrack = (event) => {
    const video = $("remoteVideo");
    if (video) {
      video.srcObject = event.streams[0];
      video.play().catch(() => {});
    }
    status("Video connection established.");
  };

  peer.onconnectionstatechange = () => {
    if (peer) {
      status("Call status: " + peer.connectionState);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });
  }

  return peer;
}

async function flushIce() {
  while (peer && queuedIce.length) {
    const candidate = queuedIce.shift();
    try {
      await peer.addIceCandidate(candidate);
    } catch (error) {
      console.error(error);
    }
  }
}

async function makeOffer() {
  try {
    if (!peer) createPeer();

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    send({
      type: "offer",
      description: peer.localDescription
    });
  } catch (error) {
    status("Could not start call: " + error.message);
  }
}

async function joinCall() {
  try {
    if (!joined) {
      status("Please wait for the session server to connect.");
      return;
    }

    status("Requesting camera and microphone permission...");

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });

    const localVideo = $("localVideo");
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.play().catch(() => {});
    }

    if (role === "host" && pendingOffer) {
      createPeer();
      await peer.setRemoteDescription(pendingOffer.description);
      await flushIce();

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      send({
        type: "answer",
        description: peer.localDescription
      });

      pendingOffer = null;
      status("Joining the call...");
    } else if (role === "guest") {
      if (!peer) createPeer();
      await makeOffer();
    } else {
      status("Waiting for the other person to join.");
    }
  } catch (error) {
    status("Camera/microphone error: " + error.message);
  }
}

function toggleTrack(kind) {
  if (!localStream) {
    status("Join the call first.");
    return;
  }

  const tracks = localStream.getTracks()
    .filter((track) => track.kind === kind);

  tracks.forEach((track) => {
    track.enabled = !track.enabled;
  });

  status(kind + (tracks[0]?.enabled ? " enabled." : " disabled."));
}

function closePeer() {
  if (peer) {
    peer.close();
    peer = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  const localVideo = $("localVideo");
  const remoteVideo = $("remoteVideo");

  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
}

function leaveCall() {
  send({ type: "leave" });
  closePeer();
  status("You have left the call.");
}

async function endSession() {
  send({ type: "end-session" });
  closePeer();
  status("Session ended.");
}

async function copyInvite() {
  const link = $("inviteLink");
  if (!link) return;

  try {
    await navigator.clipboard.writeText(link.value);
    status("Invitation link copied.");
  } catch {
    link.select();
    document.execCommand("copy");
    status("Try sharing the selected invitation link.");
  }
}

function bind(id, handler) {
  const el = $(id);
  if (el) el.addEventListener("click", handler);
}

document.addEventListener("DOMContentLoaded", () => {
  bind("createTwoWay", () => createSession("two-way"));
  bind("createOneWay", () => createSession("one-way"));
  bind("joinCall", joinCall);
  bind("muteAudio", () => toggleTrack("audio"));
  bind("toggleCamera", () => toggleTrack("video"));
  bind("leaveCall", leaveCall);
  bind("endSession", endSession);
  bind("copyInvite", copyInvite);

  const params = new URLSearchParams(location.search);
  const invitedRoom = params.get("room");

  if (invitedRoom) {
    roomId = invitedRoom;
    role = "guest";

    fetch(`/api/rooms/${encodeURIComponent(roomId)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Invitation invalid or expired.");
        return response.json();
      })
      .then((data) => {
        mode = data.mode;
        status("Invitation opened. Tap Join to continue.");
        connectSocket();
      })
      .catch((error) => status(error.message));
  } else {
    status("Welcome to ConnectLive. Create a session to begin.");
  }
});
