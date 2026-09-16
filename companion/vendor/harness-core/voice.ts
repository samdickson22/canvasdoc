import { useEffect, useMemo, useRef, useState } from "react";
import { resource } from "@assistant-ui/tap";
import type { Harness } from "./harness.ts";

type Globals = {
  RTCPeerConnection?: typeof RTCPeerConnection;
  MediaStream?: typeof MediaStream;
  Audio?: typeof Audio;
  navigator?: { mediaDevices?: MediaDevices };
};

const webrtcGlobals = () => {
  const g = globalThis as Globals;
  const missing = [
    g.RTCPeerConnection === undefined && "RTCPeerConnection",
    g.MediaStream === undefined && "MediaStream",
    g.Audio === undefined && "Audio",
    g.navigator?.mediaDevices === undefined && "navigator.mediaDevices",
  ].filter((name) => name !== false);
  if (missing.length > 0)
    throw new Error(
      `harness: voice needs ${missing.join(", ")} in this environment`,
    );
  return {
    RTCPeerConnection: g.RTCPeerConnection!,
    MediaStream: g.MediaStream!,
    Audio: g.Audio!,
    mediaDevices: g.navigator!.mediaDevices!,
  };
};

const iceComplete = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    const check = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });

type Session = {
  readonly pc: RTCPeerConnection;
  readonly audio: HTMLAudioElement;
  tracks: readonly MediaStreamTrack[];
};

const release = ({ pc, audio, tracks }: Session) => {
  for (const track of tracks) track.stop();
  pc.close();
  audio.srcObject = null;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The browser media leg: microphone in, one recvonly audio transceiver out through an `Audio` element. */
export const useWebRtcMedia = (): Harness.Voice.Media => {
  const [connection, setConnection] = useState<Harness.Voice.Connection>({
    status: "idle",
  });
  // Refs are the truth for the guards: the rendered `connection` lags a flush behind.
  const statusRef = useRef(connection.status);
  const sessionRef = useRef<Session | null>(null);
  const transition = (next: Harness.Voice.Connection) => {
    statusRef.current = next.status;
    setConnection(next);
  };

  const close = () => {
    const previous = statusRef.current;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session !== null) release(session);
    if (previous !== "idle") transition({ status: "idle" });
    return previous;
  };
  useEffect(() => () => void close(), []);

  return useMemo(
    () => ({
      connection,
      // Guard failures throw synchronously; only the negotiation itself rejects.
      open: (negotiate) => {
        if (sessionRef.current !== null)
          throw new Error(`harness: voice is already ${statusRef.current}`);
        const g = webrtcGlobals();
        const pc = new g.RTCPeerConnection();
        const audio = new g.Audio();
        audio.autoplay = true;
        const session: Session = { pc, audio, tracks: [] };
        sessionRef.current = session;
        transition({ status: "connecting" });
        const interrupted = () => sessionRef.current !== session;
        return (async () => {
          try {
            const stream = await g.mediaDevices.getUserMedia({ audio: true });
            if (interrupted()) {
              for (const track of stream.getTracks()) track.stop();
              return false;
            }
            session.tracks = stream.getTracks();
            for (const track of session.tracks) pc.addTrack(track, stream);
            pc.addTransceiver("audio", { direction: "recvonly" });
            pc.ontrack = (event) => {
              audio.srcObject =
                event.streams[0] ?? new g.MediaStream([event.track]);
            };
            pc.onconnectionstatechange = () => {
              if (interrupted() || pc.connectionState !== "failed") return;
              sessionRef.current = null;
              release(session);
              transition({
                status: "error",
                error: "harness: the voice connection failed",
              });
            };
            await pc.setLocalDescription(await pc.createOffer());
            await iceComplete(pc);
            if (interrupted()) return false;
            const sdp = pc.localDescription?.sdp;
            if (!sdp) throw new Error("harness: no local SDP offer");
            const answer = await negotiate(sdp);
            if (interrupted()) return false;
            await pc.setRemoteDescription({ type: "answer", sdp: answer });
            if (interrupted()) return false;
            transition({ status: "live" });
            return true;
          } catch (error) {
            if (interrupted()) return false;
            sessionRef.current = null;
            release(session);
            transition({ status: "error", error: errorMessage(error) });
            throw error;
          }
        })();
      },
      close,
      setMicEnabled: (enabled) => {
        const session = sessionRef.current;
        if (session === null) throw new Error("harness: voice is not open");
        for (const track of session.tracks) track.enabled = enabled;
      },
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [connection],
  );
};

export const WebRtcMedia = resource(useWebRtcMedia);
