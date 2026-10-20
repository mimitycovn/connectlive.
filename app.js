const $ = (id) => document.getElementById(id);
const views = ["homeView","hostView","guestView","endedView","errorView"];
function show(id){views.forEach(v=>$(v).classList.toggle("hidden",v!==id));}
const params = new URLSearchParams(location.search);
const roomId = params.get("room");
const hostToken = params.get("key");
let selectedMode = "two-way", mode = "two-way", socket, pc, localStream, remoteStream, role, roomCreated = false;
let micOn = true, camOn = true;
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

document.querySelectorAll(".mode-card").forEach(btn=>btn.addEventListener("click",()=>{
  selectedMode=btn.dataset.mode;
  document.querySelectorAll(".mode-card").forEach(b=>b.classList.toggle("selected",b===btn));
}));

$("createBtn").addEventListener("click", async()=>{
  $("createBtn").disabled=true; $("createBtn").textContent="Creating session…";
  try{
    const r=await fetch("/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:selectedMode})});
    if(!r.ok) throw new Error("Could not create a session.");
    const data=await r.json(); mode=data.mode; role="host"; roomCreated=true;
    const invite=new URL(location.href); invite.search=""; invite.searchParams.set("room",data.roomId);
    $("inviteUrl").value=invite.toString();
    $("localBox").classList.toggle("hidden",mode!=="two-way");
    show("hostView");
    connectSocket(()=>send({type:"join",role:"host",roomId:data.roomId,hostToken:data.hostToken}));
    // Store host authorization only in this page's URL, not in the guest invite.
    const hostUrl=new URL(location.href); hostUrl.searchParams.set("room",data.roomId); hostUrl.searchParams.set("key",data.hostToken);
    history.replaceState({}, "", hostUrl.pathname+hostUrl.search);
  }catch(e){alert(e.message||"Something went wrong.");}
  finally{$("createBtn").disabled=false;$("createBtn").textContent="＋ Create a session";}
});
$("copyBtn").addEventListener("click",async()=>{
  try{await navigator.clipboard.writeText($("inviteUrl").value);$("copyStatus").textContent="Invitation copied. Send it only to the intended person.";}
  catch{$("inviteUrl").select();document.execCommand("copy");$("copyStatus").textContent="Invitation copied.";}
});
$("endBtn").addEventListener("click",()=>{
  if(socket?.readyState===WebSocket.OPEN)send({type:"end-session"});
  cleanup();show("endedView");
});
$("consentCheck").addEventListener("change",()=>{$("joinBtn").disabled=!$("consentCheck").checked;});
$("joinBtn").addEventListener("click",async()=>{
  $("joinBtn").disabled=true;$("guestStatus").textContent="Requesting your chosen device permissions…";
  try{
    // Only requested after the guest explicitly checks consent and presses Join.
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    $("guestLocal").srcObject=localStream;
    $("guestVideos").classList.remove("hidden");$("guestControls").classList.remove("hidden");
    connectSocket(()=>send({type:"join",role:"guest",roomId}));
  }catch(e){
    $("guestStatus").textContent="Camera/microphone access was not granted. You can allow access in browser settings and try again.";
    $("joinBtn").disabled=false;
  }
});
$("leaveBtn").addEventListener("click",()=>{if(socket?.readyState===WebSocket.OPEN)send({type:"leave"});cleanup();show("endedView");});
$("guestMic").addEventListener("click",()=>toggleTrack("audio","guestMic"));
$("guestCam").addEventListener("click",()=>toggleTrack("video","guestCam"));
$("hostMic").addEventListener("click",()=>toggleTrack("audio","hostMic"));
$("hostCam").addEventListener("click",()=>toggleTrack("video","hostCam"));

function connectSocket(onOpen){
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  socket=new WebSocket(`${protocol}//${location.host}`);
  socket.onopen=onOpen;
  socket.onmessage=async(ev)=>{
    const msg=JSON.parse(ev.data);
    if(msg.type==="error"){ $("guestStatus").textContent=msg.message; $("hostStatus").textContent=msg.message; return; }
    if(msg.type==="joined"){mode=msg.mode; if(role==="guest")$("guestStatus").textContent="Connected to the session. Waiting for the host…";return;}
    if(msg.type==="peer-ready"){
      if(role==="guest") await createOffer();
      else $("hostStatus").textContent="Person joined. Establishing live connection…";
      return;
    }
    if(msg.type==="offer"){
      if(role==="host") await acceptOffer(msg.offer);
      return;
    }
    if(msg.type==="answer" && pc){await pc.setRemoteDescription(msg.answer);return;}
    if(msg.type==="ice" && pc && msg.candidate){try{await pc.addIceCandidate(msg.candidate)}catch{}return;}
    if(msg.type==="peer-left"){
      $("hostStatus").textContent="The other person left the session.";
      if(role==="guest")$("guestStatus").textContent="The host disconnected.";
      closePeer();return;
    }
    if(msg.type==="session-ended"){cleanup();show("endedView");}
  };
  socket.onclose=()=>{if(role==="host" && roomCreated && !$("endedView").classList.contains("hidden"))return;};
}
function send(obj){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(obj));}
function makePeer(){
  pc=new RTCPeerConnection(rtcConfig);
  remoteStream=new MediaStream();
  const remoteVideo=role==="host"?$("remoteVideo"):$("guestRemote");
  remoteVideo.srcObject=remoteStream;
  pc.ontrack=e=>{e.streams[0].getTracks().forEach(t=>{if(!remoteStream.getTracks().some(x=>x.id===t.id))remoteStream.addTrack(t)});};
  pc.onicecandidate=e=>{if(e.candidate)send({type:"ice",candidate:e.candidate});};
  pc.onconnectionstatechange=()=>{
    const state=pc?.connectionState;
    if(state==="connected"){
      if(role==="host")$("hostStatus").textContent="Live connection established.";
      else $("guestStatus").textContent="You are live. You can mute, turn off your camera, or leave at any time.";
    } else if(state==="failed") {
      if(role==="host")$("hostStatus").textContent="Connection failed. Try again with a stronger network.";
      else $("guestStatus").textContent="Connection failed. Please try again.";
    }
  };
  return pc;
}
async function createOffer(){
  if(pc)return;
  makePeer();
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);send({type:"offer",offer:pc.localDescription});
}
async function acceptOffer(offer){
  if(pc)closePeer();
  makePeer();
  if(mode==="two-way"){
    try{
      // Host's camera/microphone is requested only in two-way mode, after the guest has joined.
      localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
      $("localVideo").srcObject=localStream;
      $("hostMic").classList.remove("hidden");$("hostCam").classList.remove("hidden");
      localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    }catch(e){
      $("hostStatus").textContent="Your camera/mic permission was not granted. You can still receive the guest's stream.";
    }
  }
  await pc.setRemoteDescription(offer);
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);send({type:"answer",answer:pc.localDescription});
}
function toggleTrack(kind,buttonId){
  if(!localStream)return;
  const track=localStream.getTracks().find(t=>t.kind===kind);if(!track)return;
  track.enabled=!track.enabled;
  const isOn=track.enabled;
  $(buttonId).textContent=kind==="audio"?(isOn?"Mute microphone":"Unmute microphone"):(isOn?"Turn camera off":"Turn camera on");
}
function closePeer(){if(pc){pc.close();pc=null;}if(remoteStream){remoteStream.getTracks().forEach(t=>t.stop());remoteStream=null;}}
function cleanup(){
  closePeer();if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  if(socket){socket.close();socket=null;}
}
window.addEventListener("beforeunload",()=>{if(socket?.readyState===WebSocket.OPEN)send({type:"leave"});cleanup();});

async function init(){
  if(!roomId){show("homeView");return;}
  if(hostToken){
    role="host";
    try{
      const r=await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
      if(!r.ok)throw new Error("Session not found or expired.");
      const data=await r.json();mode=data.mode;
      $("localBox").classList.toggle("hidden",mode!=="two-way");
      // Restore host dashboard and use the secret token in the URL.
      const invite=new URL(location.href);invite.searchParams.delete("key");$("inviteUrl").value=invite.toString();
      show("hostView");
      connectSocket(()=>send({type:"join",role:"host",roomId,hostToken}));
    }catch(e){$("errorText").textContent=e.message;show("errorView");}
  }else{
    role="guest";
    try{
      const r=await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
      if(!r.ok)throw new Error("This invitation is invalid or the session has ended.");
      const data=await r.json();mode=data.mode;
      $("guestExplanation").textContent=mode==="one-way"?"The host will be able to see and hear the camera and microphone you choose to share. The host does not need to share their own camera.":"You and the host can share live video and audio after you both choose to enable your devices.";
      show("guestView");
    }catch(e){$("errorText").textContent=e.message;show("errorView");}
  }
}
init();
  
