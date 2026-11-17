// Types for the parts of signalsmith-stretch (MIT) the Mixer uses.
declare module "signalsmith-stretch" {
  export type StretchNode = AudioNode & {
    addBuffers(channels: Float32Array[]): Promise<number>;
    schedule(change: { output?: number; active?: boolean; input?: number; rate?: number; semitones?: number }): void;
  };
  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
