// Writes an Ableton Live 12 set (.als: gzipped XML) with one audio track per stem, every clip at bar 1.
// The element layout is ported from als-generator (github.com/daitomanabe/als-generator), whose sets open in Live 12.4:
//   MIT License, Copyright (c) 2026 Daito Manabe. Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files, to deal in the Software without restriction, subject to
//   including the copyright notice and this permission notice in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
// Live is strict: every list member carries an Id, Ids in the pointee namespace (Pointee, AutomationTarget,
// ModulationTarget) are unique, and NextPointeeId lies above every Id in the file. Otherwise Live refuses the set.
import { gzipSync } from 'fflate';

export type AudioInfo = { frames: number; sampleRate: number };

export type LiveSetClip = {
  name: string;
  // Path from the project folder, e.g. "Samples/Imported/bass.wav"
  path: string;
  size: number;
  // Live compares the low 16 bits of the CRC-32 of the file and rescans it when they differ
  crc: number;
  info: AudioInfo;
};

export type LiveSet = { tempo: number; clips: LiveSetClip[]; locators: { seconds: number; name: string }[] };

// Frame count and sample rate from the start of a WAV, AIFF, FLAC or MP3 file; null when the head doesn't tell
export function probeAudio(head: Uint8Array, fileSize: number): AudioInfo | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (at: number) => (at + 4 <= head.length ? String.fromCharCode(...head.subarray(at, at + 4)) : '');
  const info = (frames: number, sampleRate: number) =>
    Number.isFinite(frames) && frames > 0 && sampleRate > 0 ? { frames: Math.floor(frames), sampleRate: Math.round(sampleRate) } : null;

  if ((tag(0) === 'RIFF' || tag(0) === 'RF64') && tag(8) === 'WAVE') {
    let blockAlign = 0;
    let sampleRate = 0;
    for (let pos = 12; pos + 8 <= head.length; ) {
      const size = view.getUint32(pos + 4, true);
      const body = pos + 8;
      if (tag(pos) === 'fmt ' && body + 16 <= head.length) {
        sampleRate = view.getUint32(body + 4, true);
        blockAlign = view.getUint16(body + 12, true);
      } else if (tag(pos) === 'data') {
        // Streamed and RF64 files leave the size open (0xFFFFFFFF): the data then runs to the end of the file
        const bytes = size === 0xffffffff ? fileSize - body : Math.min(size, fileSize - body);
        return blockAlign ? info(bytes / blockAlign, sampleRate) : null;
      }
      pos = body + size + (size & 1);
    }
    return null;
  }

  if (tag(0) === 'FORM' && (tag(8) === 'AIFF' || tag(8) === 'AIFC')) {
    for (let pos = 12; pos + 8 <= head.length; ) {
      const size = view.getUint32(pos + 4);
      const body = pos + 8;
      if (tag(pos) === 'COMM' && body + 18 <= head.length) {
        // The rate is an 80-bit extended float: 15-bit exponent and a 64-bit mantissa with an explicit integer bit
        const exponent = view.getUint16(body + 8) & 0x7fff;
        const mantissa = view.getUint32(body + 10) * 2 ** 32 + view.getUint32(body + 14);
        return info(view.getUint32(body + 2), mantissa * 2 ** (exponent - 16383 - 63));
      }
      pos = body + size + (size & 1);
    }
    return null;
  }

  if (tag(0) === 'fLaC') {
    // STREAMINFO is always the first metadata block; its sample rate and total sample count start at byte 10
    if (head.length < 26 || (head[4]! & 0x7f) !== 0) return null;
    const sampleRate = (head[18]! << 12) | (head[19]! << 4) | (head[20]! >> 4);
    return info((head[21]! & 0x0f) * 2 ** 32 + view.getUint32(22), sampleRate);
  }

  return probeMp3(head, view, fileSize);
}

const MP3_BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// MPEG layer III: the frame count from the Xing/Info header that encoders write into the first frame, otherwise
// estimated from the bitrate
function probeMp3(head: Uint8Array, view: DataView, fileSize: number): AudioInfo | null {
  let pos = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33 && head.length >= 10) {
    const size = ((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f);
    pos = 10 + size + (head[5]! & 0x10 ? 10 : 0);
  }
  if (pos + 4 > head.length || head[pos] !== 0xff || (head[pos + 1]! & 0xe0) !== 0xe0) return null;

  const version = (head[pos + 1]! >> 3) & 3;
  const layer = (head[pos + 1]! >> 1) & 3;
  const rates = MP3_RATES[version];
  const bitrate = MP3_BITRATES[version === 3 ? 1 : 2][head[pos + 2]! >> 4];
  const sampleRate = rates?.[(head[pos + 2]! >> 2) & 3];
  if (layer !== 1 || !bitrate || !sampleRate) return null;

  const samplesPerFrame = version === 3 ? 1152 : 576;
  const mono = head[pos + 3]! >> 6 === 3;
  const xing = pos + 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
  const xingTag = xing + 12 <= head.length ? String.fromCharCode(...head.subarray(xing, xing + 4)) : '';
  if ((xingTag === 'Xing' || xingTag === 'Info') && view.getUint32(xing + 4) & 1) {
    return { frames: view.getUint32(xing + 8) * samplesPerFrame, sampleRate };
  }
  const frames = Math.floor((((fileSize - pos) * 8) / (bitrate * 1000)) * sampleRate);
  return frames > 0 ? { frames, sampleRate } : null;
}

// Live's colour indexes, one after the other so neighbouring tracks differ
const COLORS = [1, 2, 3, 5, 7, 8, 9, 11, 13, 15, 18, 20, 22, 25];
const SCENES = 8;
const VOLUME_MIN = '0.0003162277571';
const VOLUME_MAX = '1.99526238';
const MPE = '<MpeSettings><ZoneType Value="0"/><FirstNoteChannel Value="1"/><LastNoteChannel Value="15"/></MpeSettings><MpePitchBendUsesTuning Value="true"/>';

const esc = (s: string) =>
  s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Number(v.toPrecision(12)));

class Ids {
  constructor(private next: number) {}
  take() {
    return this.next++;
  }
  peek() {
    return this.next;
  }
}

export function liveSetXml(set: LiveSet): string {
  // Two ranges that cannot meet: automation targets from 1, pointees from 2,000,000
  const aid = new Ids(1);
  const pid = new Ids(2_000_000);
  const tempo = Math.min(999, Math.max(20, set.tempo));
  const beats = (seconds: number) => (seconds * tempo) / 60;

  const onBool = () =>
    `<On><LomId Value="0"/><Manual Value="true"/><AutomationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></AutomationTarget>` +
    `<MidiCCOnOffThresholds><Min Value="64"/><Max Value="127"/></MidiCCOnOffThresholds></On>`;
  const speaker = () =>
    `<Speaker><LomId Value="0"/><Manual Value="true"/><AutomationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></AutomationTarget>` +
    `<MidiCCOnOffThresholds><Min Value="64"/><Max Value="127"/></MidiCCOnOffThresholds></Speaker>`;
  const param = (name: string, value: string, lo: string, hi: string) =>
    `<${name}><LomId Value="0"/><Manual Value="${value}"/><MidiControllerRange><Min Value="${lo}"/><Max Value="${hi}"/></MidiControllerRange>` +
    `<AutomationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></AutomationTarget>` +
    `<ModulationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></ModulationTarget></${name}>`;
  const crossFadeState = () =>
    `<CrossFadeState><LomId Value="0"/><Manual Value="1"/><AutomationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></AutomationTarget>` +
    `<MidiControllerRange><Min Value="0"/><Max Value="2"/></MidiControllerRange></CrossFadeState><SendsListWrapper LomId="0"/>`;
  const deviceHeader = (pointee: number, timeableIndex = 0) =>
    `<LomId Value="0"/><LomIdView Value="0"/><IsExpanded Value="true"/><BreakoutIsExpanded Value="false"/>${onBool()}` +
    `<ModulationSourceCount Value="0"/><ParametersListWrapper LomId="0"/><Pointee Id="${pointee}"/>` +
    `<LastSelectedTimeableIndex Value="${timeableIndex}"/><LastSelectedClipEnvelopeIndex Value="0"/><LastPresetRef><Value/></LastPresetRef>` +
    `<LockedScripts/><IsFolded Value="false"/><ShouldShowPresetName Value="false"/><UserName Value=""/><Annotation Value=""/>` +
    `<SourceContext><Value/></SourceContext><MpePitchBendUsesTuning Value="true"/><ViewData Value="{}"/>`;
  const mixerParams = (volume: string, width: number) =>
    `<Sends/>${speaker()}<SoloSink Value="false"/><PanMode Value="0"/>` +
    param('Pan', '0', '-1', '1') +
    param('SplitStereoPanL', '-1', '-1', '1') +
    param('SplitStereoPanR', '1', '-1', '1') +
    param('Volume', volume, VOLUME_MIN, VOLUME_MAX) +
    `<ViewStateSessionTrackWidth Value="${width}"/>${crossFadeState()}`;
  const trackHead = (name: string, userName: string, color: number, envelopes: string, unfolded: boolean) =>
    `<LomId Value="0"/><LomIdView Value="0"/><IsContentSelectedInDocument Value="false"/><PreferredContentViewMode Value="0"/>` +
    `<TrackDelay><Value Value="0"/><IsValueSampleBased Value="false"/></TrackDelay>` +
    `<Name><EffectiveName Value="${esc(name)}"/><UserName Value="${esc(userName)}"/><Annotation Value=""/><MemorizedFirstClipName Value=""/></Name>` +
    `<Color Value="${color}"/><AutomationEnvelopes>${envelopes}</AutomationEnvelopes><TrackGroupId Value="-1"/><TrackUnfolded Value="${unfolded}"/>` +
    `<DevicesListWrapper LomId="0"/><ClipSlotsListWrapper LomId="0"/><ArrangementClipsListWrapper LomId="0"/><TakeLanesListWrapper LomId="0"/>` +
    `<ViewData Value="{}"/><TakeLanes><TakeLanes/><AreTakeLanesFolded Value="true"/></TakeLanes><LinkedTrackGroupId Value="-1"/>`;
  const automationLanes = (device: number, envelope: number, height: number) =>
    `<AutomationLanes><AutomationLanes><AutomationLane Id="0"><SelectedDevice Value="${device}"/><SelectedEnvelope Value="${envelope}"/>` +
    `<IsContentSelectedInDocument Value="false"/><LaneHeight Value="${height}"/></AutomationLane></AutomationLanes>` +
    `<AreAdditionalAutomationLanesFolded Value="false"/></AutomationLanes>`;
  const chooser = (device: number, envelope: number) =>
    `<ClipEnvelopeChooserViewState><SelectedDevice Value="${device}"/><SelectedEnvelope Value="${envelope}"/><PreferModulationVisible Value="false"/></ClipEnvelopeChooserViewState>`;
  const routing = (input: string, inputLower: string, output: string, outputUpper: string, outputLower: string) =>
    `<AudioInputRouting><Target Value="${input}"/><UpperDisplayString Value="Ext. In"/><LowerDisplayString Value="${inputLower}"/>${MPE}</AudioInputRouting>` +
    `<MidiInputRouting><Target Value="MidiIn/External.All/-1"/><UpperDisplayString Value="Ext: All Ins"/><LowerDisplayString Value=""/>${MPE}</MidiInputRouting>` +
    `<AudioOutputRouting><Target Value="${output}"/><UpperDisplayString Value="${outputUpper}"/><LowerDisplayString Value="${outputLower}"/>${MPE}</AudioOutputRouting>` +
    `<MidiOutputRouting><Target Value="MidiOut/None"/><UpperDisplayString Value="None"/><LowerDisplayString Value=""/>${MPE}</MidiOutputRouting>`;
  const mainRouting = () => routing('AudioIn/External/S0', '1/2', 'AudioOut/External/S0', 'Ext. Out', '1/2');
  const clipSlots = () =>
    Array.from({ length: SCENES }, (_, i) =>
      `<ClipSlot Id="${i}"><LomId Value="0"/><ClipSlot><Value/></ClipSlot><HasStop Value="true"/><NeedRefreeze Value="true"/></ClipSlot>`,
    ).join('');
  const modulationTargets = () =>
    ['Volume', 'Transposition', 'TransientEnvelope', 'GrainSize', 'Flux', 'SampleOffset', 'ComplexProFormants', 'ComplexProEnvelope']
      .map((n) => `<${n}ModulationTarget Id="${aid.take()}"><LockEnvelope Value="0"/></${n}ModulationTarget>`)
      .join('');
  const sequencerTail =
    '<PitchViewScrollPosition Value="-1073741824"/><SampleOffsetModulationScrollPosition Value="-1073741824"/>' +
    '<Recorder><IsArmed Value="false"/><TakeCounter Value="1"/></Recorder>';
  const sequencer = (pointee: number, monitoring: number, events: string) =>
    `${deviceHeader(pointee)}<ClipSlotList>${clipSlots()}</ClipSlotList><MonitoringEnum Value="${monitoring}"/>` +
    `<KeepRecordMonitoringLatency Value="true"/><Sample><ArrangerAutomation>${events ? `<Events>${events}</Events>` : '<Events/>'}` +
    `<AutomationTransformViewState><IsTransformPending Value="false"/><TimeAndValueTransforms/></AutomationTransformViewState></ArrangerAutomation></Sample>` +
    `${modulationTargets()}${sequencerTail}`;

  // Not warped: the stem plays sample for sample as it was bounced, whatever the set's tempo. An unwarped clip keeps
  // its loop and markers in seconds, its place in the arrangement in beats.
  const clip = (c: LiveSetClip, color: number) => {
    const seconds = c.info.frames / c.info.sampleRate;
    const length = beats(seconds);
    return (
      `<AudioClip Id="0" Time="0"><LomId Value="0"/><LomIdView Value="0"/>` +
      `<CurrentStart Value="0"/><CurrentEnd Value="${num(length)}"/>` +
      `<Loop><LoopStart Value="0"/><LoopEnd Value="${num(seconds)}"/><StartRelative Value="0"/><LoopOn Value="false"/>` +
      `<OutMarker Value="${num(seconds)}"/><HiddenLoopStart Value="0"/><HiddenLoopEnd Value="${num(seconds)}"/></Loop>` +
      `<Name Value="${esc(c.name)}"/><Annotation Value=""/><Color Value="${color}"/><LaunchMode Value="0"/><LaunchQuantisation Value="0"/>` +
      `<TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0"><Numerator Value="4"/><Denominator Value="4"/><Time Value="0"/>` +
      `</RemoteableTimeSignature></TimeSignatures></TimeSignature><Envelopes><Envelopes/></Envelopes>` +
      `<ScrollerTimePreserver><LeftTime Value="0"/><RightTime Value="${num(length)}"/></ScrollerTimePreserver>` +
      `<TimeSelection><AnchorTime Value="0"/><OtherTime Value="0"/></TimeSelection><Legato Value="false"/><Ram Value="false"/>` +
      `<GrooveSettings><GrooveId Value="-1"/></GrooveSettings><Disabled Value="false"/><VelocityAmount Value="0"/>` +
      `<FollowAction><FollowTime Value="4"/><IsLinked Value="true"/><LoopIterations Value="1"/><FollowActionA Value="4"/><FollowActionB Value="0"/>` +
      `<FollowChanceA Value="100"/><FollowChanceB Value="0"/><JumpIndexA Value="1"/><JumpIndexB Value="1"/><FollowActionEnabled Value="false"/></FollowAction>` +
      `<Grid><FixedNumerator Value="1"/><FixedDenominator Value="16"/><GridIntervalPixel Value="20"/><Ntoles Value="2"/><SnapToGrid Value="true"/><Fixed Value="false"/></Grid>` +
      `<FreezeStart Value="0"/><FreezeEnd Value="0"/><IsWarped Value="false"/><TakeId Value="-1"/><IsInKey Value="true"/>` +
      `<ScaleInformation><Root Value="0"/><Name Value="0"/></ScaleInformation>` +
      `<SampleRef><FileRef><RelativePathType Value="3"/><RelativePath Value="${esc(c.path)}"/><Path Value="${esc(c.path)}"/><Type Value="2"/>` +
      `<LivePackName Value=""/><LivePackId Value=""/><OriginalFileSize Value="${c.size}"/><OriginalCrc Value="${c.crc & 0xffff}"/><SourceHint Value=""/></FileRef>` +
      `<LastModDate Value="0"/><SourceContext/><SampleUsageHint Value="0"/><DefaultDuration Value="${c.info.frames}"/>` +
      `<DefaultSampleRate Value="${c.info.sampleRate}"/><SamplesToAutoWarp Value="0"/></SampleRef>` +
      `<Onsets><UserOnsets/><HasUserOnsets Value="false"/></Onsets><WarpMode Value="0"/>` +
      `<GranularityTones Value="30"/><GranularityTexture Value="65"/><FluctuationTexture Value="25"/><TransientResolution Value="6"/>` +
      `<TransientLoopMode Value="2"/><TransientEnvelope Value="100"/><ComplexProFormants Value="100"/><ComplexProEnvelope Value="128"/>` +
      `<Sync Value="true"/><HiQ Value="true"/><Fade Value="true"/>` +
      `<Fades><FadeInLength Value="0"/><FadeOutLength Value="0"/><ClipFadesAreInitialized Value="true"/><CrossfadeInState Value="0"/>` +
      `<FadeInCurveSkew Value="0"/><FadeInCurveSlope Value="0"/><FadeOutCurveSkew Value="0"/><FadeOutCurveSlope Value="0"/>` +
      `<IsDefaultFadeIn Value="false"/><IsDefaultFadeOut Value="false"/></Fades>` +
      `<PitchCoarse Value="0"/><PitchFine Value="0"/><SampleVolume Value="1"/>` +
      `<WarpMarkers><WarpMarker Id="0" SecTime="0" BeatTime="0"/><WarpMarker Id="1" SecTime="${num(seconds)}" BeatTime="${num(length)}"/>` +
      `<WarpMarker Id="2" SecTime="${num(seconds + 60 / tempo / 32)}" BeatTime="${num(length + 1 / 32)}"/></WarpMarkers>` +
      `<SavedWarpMarkersForStretched/><MarkersGenerated Value="false"/><IsSongTempoLeader Value="false"/></AudioClip>`
    );
  };

  const audioTrack = (c: LiveSetClip, index: number) => {
    const color = COLORS[index % COLORS.length]!;
    const [mixer, main, freeze] = [pid.take(), pid.take(), pid.take()];
    return (
      `<AudioTrack Id="${8 + index}" SelectedToolPanel="3" SelectedTransformationName="" SelectedGeneratorName="">` +
      trackHead(c.name, c.name, color, '<Envelopes/>', true) +
      `<SavedPlayingSlot Value="-1"/><SavedPlayingOffset Value="0"/><Freeze Value="false"/><NeedArrangerRefreeze Value="true"/><PostProcessFreezeClips Value="0"/>` +
      `<DeviceChain>${automationLanes(1, 0, 68)}${chooser(1, 2)}` +
      routing('AudioIn/External/M0', '1', 'AudioOut/Main', 'Master', '') +
      `<Mixer>${deviceHeader(mixer)}${mixerParams('1', 93)}</Mixer>` +
      `<MainSequencer>${sequencer(main, 2, clip(c, color))}</MainSequencer>` +
      `<FreezeSequencer>${sequencer(freeze, 1, '')}</FreezeSequencer>` +
      `<DeviceChain><Devices/><SignalModulations/></DeviceChain></DeviceChain><IsTuned Value="true"/></AudioTrack>`
    );
  };

  const tracks = set.clips.map(audioTrack).join('');

  const mainTrack = () => {
    const mixer = pid.take();
    const [tempoTarget, tempoModulation, signatureTarget] = [aid.take(), aid.take(), aid.take()];
    const transform = '<AutomationTransformViewState><IsTransformPending Value="false"/><TimeAndValueTransforms/></AutomationTransformViewState>';
    const envelopes =
      `<Envelopes><AutomationEnvelope Id="0"><EnvelopeTarget><PointeeId Value="${signatureTarget}"/></EnvelopeTarget>` +
      `<Automation><Events><EnumEvent Id="0" Time="-63072000" Value="201"/></Events>${transform}</Automation></AutomationEnvelope>` +
      `<AutomationEnvelope Id="1"><EnvelopeTarget><PointeeId Value="${tempoTarget}"/></EnvelopeTarget>` +
      `<Automation><Events><FloatEvent Id="0" Time="-63072000" Value="${num(tempo)}"/></Events>${transform}</Automation></AutomationEnvelope></Envelopes>`;
    return (
      `<MainTrack SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">` +
      trackHead('Main', '', 6, envelopes, false) +
      `<DeviceChain>${automationLanes(1, 4, 85)}${chooser(0, 0)}${mainRouting()}` +
      `<Mixer>${deviceHeader(mixer, 4)}${mixerParams('1', 103)}` +
      `<Tempo><LomId Value="0"/><Manual Value="${num(tempo)}"/><MidiControllerRange><Min Value="60"/><Max Value="200"/></MidiControllerRange>` +
      `<AutomationTarget Id="${tempoTarget}"><LockEnvelope Value="0"/></AutomationTarget><ModulationTarget Id="${tempoModulation}"><LockEnvelope Value="0"/></ModulationTarget></Tempo>` +
      `<TimeSignature><LomId Value="0"/><Manual Value="201"/><AutomationTarget Id="${signatureTarget}"><LockEnvelope Value="0"/></AutomationTarget>` +
      `<MidiControllerRange><Min Value="0"/><Max Value="494"/></MidiControllerRange></TimeSignature>` +
      param('GlobalGrooveAmount', '0', '0', '131.25') +
      param('CrossFade', '0', '-1', '1') +
      `<TempoAutomationViewBottom Value="60"/><TempoAutomationViewTop Value="200"/></Mixer>` +
      `<FreezeSequencer><AudioSequencer Id="0">${sequencer(pid.take(), 1, '')}</AudioSequencer></FreezeSequencer>` +
      `<DeviceChain><Devices/><SignalModulations/></DeviceChain></DeviceChain></MainTrack>`
    );
  };

  const preHearTrack = () =>
    `<PreHearTrack SelectedToolPanel="7" SelectedTransformationName="" SelectedGeneratorName="">` +
    trackHead('0-Main', '', -1, '<Envelopes/>', false) +
    `<DeviceChain>${automationLanes(0, 0, 85)}${chooser(0, 0)}${mainRouting()}` +
    `<Mixer>${deviceHeader(pid.take())}${mixerParams('0.5012149811', 74)}</Mixer>` +
    `<DeviceChain><Devices/><SignalModulations/></DeviceChain></DeviceChain></PreHearTrack>`;

  const scenes = Array.from({ length: SCENES }, (_, i) =>
    `<Scene Id="${i}"><FollowAction><FollowTime Value="4"/><IsLinked Value="true"/><LoopIterations Value="1"/><FollowActionA Value="4"/>` +
    `<FollowActionB Value="0"/><FollowChanceA Value="100"/><FollowChanceB Value="0"/><JumpIndexA Value="0"/><JumpIndexB Value="0"/>` +
    `<FollowActionEnabled Value="false"/></FollowAction><Name Value=""/><Annotation Value=""/><Color Value="-1"/><Tempo Value="${num(tempo)}"/>` +
    `<IsTempoEnabled Value="false"/><TimeSignatureId Value="201"/><IsTimeSignatureEnabled Value="false"/><LomId Value="0"/><ClipSlotsListWrapper LomId="0"/></Scene>`,
  ).join('');

  const locators = set.locators
    .map((l, i) =>
      `<Locator Id="${i}"><LomId Value="0"/><Time Value="${num(beats(l.seconds))}"/><Name Value="${esc(l.name)}"/><Annotation Value=""/><IsSongStart Value="false"/></Locator>`,
    )
    .join('');

  const main = mainTrack();
  const preHear = preHearTrack();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Ableton MajorVersion="5" MinorVersion="12.0_12300" SchemaChangeCount="1" Creator="Music Hub" Revision="">` +
    `<LiveSet><NextPointeeId Value="${Math.max(aid.peek(), pid.peek())}"/><OverwriteProtectionNumber Value="3075"/><LomId Value="0"/><LomIdView Value="0"/>` +
    `<Tracks>${tracks}</Tracks>${main}${preHear}<SendsPre/><Scenes>${scenes}</Scenes>` +
    `<Transport><PhaseNudgeTempo Value="10"/><LoopOn Value="false"/><LoopStart Value="0"/><LoopLength Value="16"/><LoopIsSongStart Value="false"/>` +
    `<CurrentTime Value="0"/><PunchIn Value="false"/><PunchOut Value="false"/><MetronomeTickDuration Value="0"/><DrawMode Value="false"/></Transport>` +
    `<SessionScrollPos X="0" Y="0"/><SelectedBreakpointValue Value="0"/><SignalModulations/><GlobalQuantisation Value="4"/><AutoQuantisation Value="0"/>` +
    `<Grid><FixedNumerator Value="1"/><FixedDenominator Value="16"/><GridIntervalPixel Value="20"/><Ntoles Value="2"/><SnapToGrid Value="true"/><Fixed Value="false"/></Grid>` +
    `<ScaleInformation><Root Value="0"/><Name Value="0"/></ScaleInformation><InKey Value="false"/><SmpteFormat Value="0"/>` +
    `<TimeSelection><AnchorTime Value="0"/><OtherTime Value="0"/></TimeSelection>` +
    `<SequencerNavigator><BeatTimeHelper><CurrentZoom Value="0.25"/></BeatTimeHelper><ScrollerPos X="0" Y="0"/><ClientSize X="828" Y="227"/></SequencerNavigator>` +
    `<IsContentSplitterOpen Value="true"/><IsExpressionSplitterOpen Value="true"/>` +
    `<ExpressionLanes><MidiEditorLaneModel Id="0"><Type Value="5"/><Size Value="41"/><IsMinimized Value="true"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="1"><Type Value="0"/><Size Value="41"/><IsMinimized Value="false"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="2"><Type Value="1"/><Size Value="41"/><IsMinimized Value="false"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="3"><Type Value="2"/><Size Value="41"/><IsMinimized Value="true"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="4"><Type Value="3"/><Size Value="41"/><IsMinimized Value="true"/></MidiEditorLaneModel></ExpressionLanes>` +
    `<ContentLanes><MidiEditorLaneModel Id="0"><Type Value="2"/><Size Value="41"/><IsMinimized Value="false"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="2"><Type Value="3"/><Size Value="25"/><IsMinimized Value="true"/></MidiEditorLaneModel>` +
    `<MidiEditorLaneModel Id="1"><Type Value="4"/><Size Value="25"/><IsMinimized Value="true"/></MidiEditorLaneModel></ContentLanes>` +
    `<ViewStateFxSlotCount Value="4"/><ViewStateSessionMixerVolumeSectionHeight Value="120"/><ViewStateArrangerMixerVolumeSectionHeight Value="120"/>` +
    `<ShouldSceneTempoAndTimeSignatureBeVisible Value="false"/><WaveformVerticalZoomFactor Value="1"/><IsWaveformVerticalZoomActive Value="true"/>` +
    `<Locators>${locators ? `<Locators>${locators}</Locators>` : '<Locators/>'}</Locators>` +
    `<DetailClipKeyMidis/><TracksListWrapper LomId="0"/><VisibleTracksListWrapper LomId="0"/><ReturnTracksListWrapper LomId="0"/><ScenesListWrapper LomId="0"/>` +
    `<CuePointsListWrapper LomId="0"/><SelectedDocumentViewInMainWindow Value="0"/><Annotation Value=""/><SoloOrPflSavedValue Value="true"/><SoloInPlace Value="true"/>` +
    `<CrossfadeCurve Value="2"/><LatencyCompensation Value="2"/><HighlightedTrackIndex Value="0"/>` +
    `<GroovePool><LomId Value="0"/><Grooves/><DefaultGrooveId Value="-1"/><GroovesListWrapper LomId="0"/></GroovePool>` +
    `<AutomationMode Value="false"/><SnapAutomationToGrid Value="true"/><ArrangementOverdub Value="false"/><ColorSequenceIndex Value="0"/>` +
    `<AutoColorPickerForPlayerAndGroupTracks><NextColorIndex Value="0"/></AutoColorPickerForPlayerAndGroupTracks>` +
    `<AutoColorPickerForReturnAndMainTracks><NextColorIndex Value="0"/></AutoColorPickerForReturnAndMainTracks><ViewData Value="{}"/>` +
    `<ResetNonautomatedMidiControllersOnClipStarts Value="true"/><MidiFoldIn Value="false"/><MidiFoldMode Value="-99"/><MultiClipFocusMode Value="false"/>` +
    `<MultiClipLoopBarHeight Value="0"/><MidiPrelisten Value="false"/><LinkedTrackGroups/><NoteSpellingPreference Value="0"/>` +
    `<AccidentalSpellingPreference Value="3"/><PreferFlatRootNote Value="false"/><UseWarperLegacyHiQMode Value="false"/>` +
    `<VideoWindowRect Top="-2147483648" Left="-2147483648" Bottom="-2147483648" Right="-2147483648"/><ShowVideoWindow Value="true"/><TuningSystems/>` +
    `<TrackHeaderWidth Value="93"/><ViewStateMainWindowClipDetailOpen Value="true"/><ViewStateMainWindowHiddenOtherDocViewTypeClipDetailOpen Value="true"/>` +
    `<ViewStateMainWindowHiddenOtherDocViewTypeDeviceDetailOpen Value="false"/><ViewStateMainWindowDeviceDetailOpen Value="false"/>` +
    `<ViewStateSecondWindowClipDetailOpen Value="false"/><ViewStateSecondWindowDeviceDetailOpen Value="true"/>` +
    `<ViewStates><MixerInArrangement Value="0"/><ArrangerMixerIO Value="1"/><ArrangerMixerSends Value="1"/><ArrangerMixerReturns Value="1"/>` +
    `<ArrangerMixerVolume Value="1"/><ArrangerMixerTrackOptions Value="0"/><ArrangerMixerCrossFade Value="0"/><ArrangerMixerTrackPerformanceImpactMeter Value="0"/>` +
    `<MixerInSession Value="1"/><SessionIO Value="1"/><SessionSends Value="1"/><SessionReturns Value="1"/><SessionVolume Value="1"/><SessionTrackOptions Value="0"/>` +
    `<SessionCrossFade Value="0"/><SessionTrackPerformanceImpactMeter Value="0"/><SessionShowOverView Value="0"/>` +
    `<ArrangerIO Value="1"/><ArrangerReturns Value="1"/><ArrangerVolume Value="1"/><ArrangerTrackOptions Value="0"/><ArrangerShowOverView Value="1"/></ViewStates>` +
    `</LiveSet></Ableton>`
  );
}

export const liveSetFile = (set: LiveSet) => gzipSync(new TextEncoder().encode(liveSetXml(set)));
