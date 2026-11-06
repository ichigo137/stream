const $ = id => document.getElementById(id);
const sections = ["home", "host", "viewer", "joinPanel"];
const config = window.STREAM_CONFIG || {};
if (!config.supabaseUrl || !config.supabasePublishableKey) {
  throw new Error("Stream is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the server.");
}
const clientId = crypto.randomUUID();
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
const rtcConfig = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
]};
let mode = "home", roomId = null, localStream = null, channel = null;
let currentRole = null, hostClientId = null, viewerOfferReceived = false;
const peers = new Map();
const earlyCandidates = new Map();

function show(name) { sections.forEach(id => $(id).classList.toggle("hidden", id !== name)); mode = name; }
function toast(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function roomFromInput(value) {
  const trimmed = value.trim();
  try { const u = new URL(trimmed); return (u.searchParams.get("room") || u.pathname.split("/").filter(Boolean).pop() || "").toLowerCase(); }
  catch { return trimmed.replace(/[^a-z0-9-]/gi, "").toLowerCase(); }
}
function roomLink(id) { return location.origin + location.pathname + "?room=" + encodeURIComponent(id); }

async function connectRoom(id, role) {
  if (channel) { await channel.unsubscribe(); channel = null; }
  roomId = id; currentRole = role; hostClientId = null;
  channel = supabaseClient.channel("stream-" + id, {
    config: {
      private: false,
      broadcast: { self: false, ack: true },
      presence: { key: clientId }
    }
  });
  channel.on("broadcast", { event: "signal" }, ({ payload }) => {
    if (payload.to && payload.to !== clientId) return;
    handleSignal(payload).catch(err => console.error("Signal error:", err));
  });
  channel.on("broadcast", { event: "room-ended" }, ({ payload }) => {
    if (currentRole !== "viewer" || payload?.from !== hostClientId) return;
    closeViewer("The host ended this stream.");
  });
  channel.on("presence", { event: "sync" }, () => {
    const members = Object.values(channel.presenceState()).flat();
    const host = members.find(p => p.role === "host");
    if (host) hostClientId = host.clientId;
    if (mode === "host") {
      $("viewerCount").textContent = members.filter(p => p.role === "viewer").length;
    } else if (mode === "viewer" && hostClientId && !host) {
      closeViewer("The host disconnected.");
    }
  });
  await new Promise((resolve, reject) => {
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        reject(new Error("Realtime channel connection failed: " + status));
      }
    });
  });
  const { error } = await channel.track({ clientId, role, joinedAt: Date.now() });
  if (error) throw error;
  if (role === "viewer") {
    const deadline = Date.now() + 10000;
    let host = null;
    while (Date.now() < deadline) {
      host = Object.values(channel.presenceState()).flat().find(p => p.role === "host");
      if (host) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!host) throw new Error("No active host in this room.");
    hostClientId = host.clientId;
  }
}
async function signal(to, data) {
  if (!channel) return;
  const { error } = await channel.send({
    type: "broadcast", event: "signal",
    payload: { from: clientId, to, data }
  });
  if (error) console.error("Broadcast failed:", error);
}
function cleanupPeers() {
  for (const pc of peers.values()) pc.close();
  peers.clear(); earlyCandidates.clear();
}
async function closeViewer(message) {
  cleanupPeers();
  if (channel) {
    const old = channel; channel = null;
    await old.untrack(); await old.unsubscribe();
  }
  currentRole = null; roomId = null;
  $("viewerVideo").srcObject = null;
  $("viewerPlaceholder").classList.remove("hidden");
  show("home");
  toast(message);
}

async function handleSignal(message) {
  const { from, data } = message;
  if (!from || from === clientId || !data) return;

  if (mode === "host") {
    let pc = peers.get(from);
    if (data.type === "join") {
      if (!localStream) return;
      if (pc?.localDescription?.type === "offer") {
        await signal(from, { type: "offer", sdp: pc.localDescription });
        return;
      }
      if (pc) { pc.close(); peers.delete(from); }
      pc = new RTCPeerConnection(rtcConfig); peers.set(from, pc);
      for (const track of localStream.getTracks()) {
        const sender = pc.addTrack(track, localStream);
        const isVideo = track.kind === "video";
        if (isVideo) track.contentHint = "detail";
        const parameters = sender.getParameters();
        if (!parameters.encodings || !parameters.encodings.length) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = isVideo ? 5000000 : 192000;
        if (isVideo) parameters.degradationPreference = "balanced";
        try {
          await sender.setParameters(parameters);
        } catch (err) {
          console.warn("Could not apply sender bitrate preference:", err);
        }
      }
      pc.onicecandidate = e => { if (e.candidate) signal(from, { type: "candidate", candidate: e.candidate }); };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) {
          pc.close(); peers.delete(from);
        }
      };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await signal(from, { type: "offer", sdp: pc.localDescription });
      return;
    }
    if (!pc) return;
    if (data.type === "answer") {
      await pc.setRemoteDescription(data.sdp);
      for (const candidate of (pc.pendingCandidates || [])) await pc.addIceCandidate(candidate);
      pc.pendingCandidates = [];
    } else if (data.type === "candidate" && data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else (pc.pendingCandidates ||= []).push(data.candidate);
    }
  } else if (mode === "viewer") {
    let pc = peers.get("host");
    if (data.type === "offer") {
      viewerOfferReceived = true;
      if (pc?.remoteDescription && pc.localDescription?.type === "answer") {
        await signal(from, { type: "answer", sdp: pc.localDescription });
        return;
      }
      if (pc) pc.close();
      pc = new RTCPeerConnection(rtcConfig); peers.set("host", pc);
      pc.ontrack = e => {
        $("viewerVideo").srcObject = e.streams[0];
        $("viewerPlaceholder").classList.add("hidden");
        document.querySelector("#viewer .status-pill").innerHTML = "<i></i> LIVE";
      };
      pc.onicecandidate = e => { if (e.candidate) signal(hostClientId || from, { type: "candidate", candidate: e.candidate }); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") toast("Connection failed. A TURN relay may be needed on this network.");
      };
      await pc.setRemoteDescription(data.sdp);
      const pending = earlyCandidates.get(from) || [];
      for (const candidate of pending) await pc.addIceCandidate(candidate);
      earlyCandidates.delete(from);
      for (const candidate of (pc.pendingCandidates || [])) await pc.addIceCandidate(candidate);
      pc.pendingCandidates = [];
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await signal(from, { type: "answer", sdp: pc.localDescription });
    } else if (data.type === "candidate" && data.candidate) {
      if (pc && pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else {
        const pending = earlyCandidates.get(from) || [];
        pending.push(data.candidate); earlyCandidates.set(from, pending);
      }
    }
  }
}

$("startBtn").onclick = async () => {
  if (!navigator.mediaDevices?.getDisplayMedia) return toast("Screen sharing requires a modern browser and HTTPS.");
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.contentHint = "music";
      try {
        await audioTrack.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        });
      } catch (err) {
        console.warn("Could not apply high-fidelity display-audio constraints:", err);
      }
    } else {
      toast("No shared audio detected. In Chrome, select the tab and enable Share tab audio.");
    }
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
    await connectRoom(id, "host");
    $("hostVideo").srcObject = localStream; $("hostPlaceholder").classList.add("hidden");
    $("shareLink").value = roomLink(id);
    localStream.getVideoTracks()[0].addEventListener("ended", endStream);
    history.replaceState({}, "", location.pathname + "?host=" + id);
    show("host");
  } catch (err) {
    if (channel) { await channel.unsubscribe(); channel = null; }
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null; currentRole = null;
    if (err.name !== "NotAllowedError") toast("Couldn't start sharing: " + err.message);
  }
};

$("copyBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("shareLink").value);
    $("copyBtn").textContent = "Copied!";
    $("copyHint").textContent = "Link copied. Send it to your viewers.";
    setTimeout(() => $("copyBtn").textContent = "Copy link", 1800);
  } catch {
    $("shareLink").select(); document.execCommand("copy"); toast("Invite link copied.");
  }
};

async function endStream() {
  if (mode !== "host") return;
  if (channel) {
    await channel.send({ type: "broadcast", event: "room-ended", payload: { from: clientId } });
    await channel.untrack(); await channel.unsubscribe(); channel = null;
  }
  cleanupPeers();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localStream = null; currentRole = null; roomId = null; $("hostVideo").srcObject = null;
  history.replaceState({}, "", location.pathname); show("home"); toast("Stream ended.");
}
$("stopBtn").onclick = endStream;
$("joinBtn").onclick = () => { show("joinPanel"); $("roomInput").focus(); };
$("backBtn").onclick = () => show("home");
$("joinForm").onsubmit = async e => {
  e.preventDefault();
  const id = roomFromInput($("roomInput").value); if (!id) return;
  $("joinError").textContent = ""; $("viewerPlaceholder").classList.remove("hidden");
  try {
    viewerOfferReceived = false;
    await connectRoom(id, "viewer");
    show("viewer");
    document.querySelector("#viewer .status-pill").innerHTML = "<i></i> CONNECTING";
    for (let attempt = 0; attempt < 6 && !viewerOfferReceived; attempt++) {
      await channel.send({
        type: "broadcast", event: "signal",
        payload: { from: clientId, data: { type: "join" } }
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!viewerOfferReceived) throw new Error("The host did not respond. Ask them to keep the stream open and try again.");
  } catch (err) {
    $("joinError").textContent = err.message === "No active host in this room."
      ? "No one is broadcasting in this room right now."
      : "Couldn't join this room. Check your connection and try again.";
    console.error(err);
    if (channel) { await channel.unsubscribe(); channel = null; }
    currentRole = null; roomId = null;
  }
};
window.addEventListener("pagehide", () => {
  if (channel) { channel.untrack(); channel.unsubscribe(); }
  cleanupPeers();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
});
const params = new URLSearchParams(location.search);
if (params.has("room")) {
  $("roomInput").value = params.get("room"); show("joinPanel"); $("joinForm").requestSubmit();
} else if (params.has("host")) {
  toast("Host sessions cannot be restored after a refresh. Start a new stream.");
  history.replaceState({}, "", location.pathname);
}
