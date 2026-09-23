#!/usr/bin/env node
// Setlist — seed.js
// Dogfood import: the real 2026-09-14/15 operation corpus becomes Setlist's
// first dataset. Sources (transcribed faithfully — statuses, dates, draft texts,
// URLs; nothing invented):
//   - ~/workspace/cwi-company/radio/followup-plan.md        (10 threads)
//   - ~/workspace/cwi-company/radio/submission-opportunities.md (25 opportunities)
//   - Track IDs from studio/ai-learning-kit/kit.json (verified catalog)
//   - Playlist URLs + verification facts from memory/2026-09-20.md (the 9/20 sweep)
//
// Every record validates through rules.js (V1–V7, G1–G5). The single deliberate
// exception: the DJ 6Rings thread is imported with { historical: true } because
// the thread PREDATES the payola flag (pitched 9/14, flagged 9/15). V1 then
// freezes it — the CLI can never advance it or pitch that curator again.
//
// Judgment calls baked into the seed (flagged in the build report):
//   S1. followup-plan's "Do-not-contact (already pitched — never re-pitch)" list
//       is about RE-PITCHING. Curators with live threads (Flow, 6Rings, WATCH THA
//       GAP, Hip-Hop High Society, Audiartist, the §9 names) keep
//       do_not_contact=false so their planned follow-ups survive; the no-repitch
//       rule is enforced by G1 (duplicate curator+track rejected). Hard
//       do_not_contact=true only for ELEVATOR, Soundplate, Hype Off Life,
//       @mcm_disco, @istashathescrub (no live thread follow-up exists).
//   S2. DJ 6Rings placement total_tracks=40 comes from the K6 fixture snapshot
//       (synthetic stand-in) — the corpus never captured the playlist length.
//       The receipt says so; re-run `setlist verify` with a live snapshot.
//   S3. Flex My Flame's track ID is 3knXIxd0PlraXvarlwGwKm (the upload the
//       9/20 API read found at #7). The AI learning kit lists a different upload
//       (7FQvcCS2CdTVsd6hb9jvHx) — possible duplicate; noted on the receipt.
//   S4. Flow's "No Label Needed" add was CONFIRMED by the 9/20 sweep (#21/21),
//       but the frozen design's seed spec lists only the 4 placement groups and
//       the 9/15 corpus has it UNVERIFIED — so it seeds as a pitch with an open
//       verification follow-up, NOT a placement. Operator resolves with `verify`.
//   S5. Exact 9/14 message texts were not retained in the corpus; seeded message
//       texts say so explicitly rather than inventing copy (G8 honesty).
//
// Usage: node seed.js [--dir ROOT] [--force]
// Refuses to run twice into the same store unless --force.

import { writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, genId, utcNow } from './store.js';
import {
  RuleError, validateTrack, validateCurator, validatePitchNew, validateMessage,
  validatePlacement, validateVerificationEvent, validateFollowup, bumpStat,
} from './rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPROVAL_REF = 'followup-plan-2026-09-15 (plan required Black\'s exact-text approval for all sends)';
const CWI = 'CWI';
const BLACK_IG = '@lanskyblack';

// Verified Spotify IDs (sources in the header).
const TID = {
  'zooted-zone': '0emH8ktA8x4DkOFLsG5xkW',
  'diabolique': '2eSyWmIdPzEMyWejLb2LBj',
  'shaka-zulu': '3pQEzg7xFqGIk0CK1Za1Kw',
  'doves-diamonds': '4NAyd7rvnuG3DrPFqXo4eQ',
  'flex-my-flame': '3knXIxd0PlraXvarlwGwKm',
  'ultimate': '2daugr3ni3r6jHH6UI57EK',
  'warped-and-wicked': '3w4RKguHAT2xd9K0w5CklC',
  'flamerz': '2MDHAUo4zJTHGXGQHUhNw0',
};
const PLAYLIST = {
  alper360: 'https://open.spotify.com/playlist/0hsLLFaADDjU54tFqaImFh',
  newRapHits: 'https://open.spotify.com/playlist/5zhnSpZqKRRaOvRMWuT0bL',
  itsGoin: 'https://open.spotify.com/playlist/1aKBRGOS2ZOMiKwleCd9KV',
};

const T = (h, m = '00') => `2026-09-${String(h).padStart(2, '0')}T${m}:00:00Z`;

function msg(date, direction, text, actor, approval_ref = null) {
  return { date, direction, text, actor, approval_ref };
}

// ---------------------------------------------------------------------------
// Section 1: tracks
// ---------------------------------------------------------------------------
const TRACKS = [
  { id: 'zooted-zone', title: 'Zooted Zone', url: TID['zooted-zone'] },
  { id: 'diabolique', title: 'Diabolique', url: TID['diabolique'], release_date: '2026-07-03' },
  { id: 'shaka-zulu', title: 'Shaka Zulu', url: TID['shaka-zulu'] },
  { id: 'doves-diamonds', title: 'Doves & Diamonds', url: TID['doves-diamonds'] },
  { id: 'flex-my-flame', title: 'Flex My Flame', url: TID['flex-my-flame'] },
  { id: 'ultimate', title: 'Ultimate', url: TID['ultimate'] },
  { id: 'warped-and-wicked', title: 'Warped and Wicked', url: TID['warped-and-wicked'] },
  { id: 'flamerz', title: 'Flamerz', url: TID['flamerz'] },
];

// ---------------------------------------------------------------------------
// Section 2: curators — threads (followup-plan.md)
// ---------------------------------------------------------------------------
function threadCurators() {
  const C = (id, name, platform, submission_path, extra = {}) => ({
    id, name, platform, submission_path,
    handles: [], playlist_urls: [], genres: [], follower_count: null, followers_observed_at: null,
    account_needed: false, payola_flag: false, payola_evidence: null,
    do_not_contact: false, dnc_reason: null,
    stats: { pitches: 0, replies: 0, placements_verified: 0 },
    notes: null, created_at: T(15, '09'), updated_at: T(15, '09'),
    ...extra,
  });
  return [
    C('hip-hop-high-society', 'Hip-Hop High Society', 'other',
      { type: 'form-url', value: 'https://hiphophighsociety.com/music-submissions/' },
      { notes: 'Submitted 2026-09-14; status "RECEIVED — TRACK\'S IN", reply promised ~2 weeks. Followup-plan DNC list = never re-pitch (G1-enforced for the same track); live-thread follow-ups stand.' }),
    C('flow-no-label-needed', 'Flow', 'spotify-playlist',
      { type: 'dm', value: 'Instagram DM @flowdigonthetrack (from @lanskyblack)' },
      { handles: ['@flowdigonthetrack'], genres: ['hip-hop'],
        notes: '"No Label Needed" playlist. 9/14: IG DM pitch; curator replied "Got u!!" + playlist link; two full scans 9/15 found no track — claimed add UNVERIFIED per the 9/15 corpus (see S4).' }),
    C('shan-dj-6rings', 'Shan / DJ 6Rings', 'spotify-playlist',
      { type: 'dm', value: 'Instagram DM @dj6rings (from @lanskyblack)' },
      { handles: ['@dj6rings'], playlist_urls: [PLAYLIST.itsGoin], genres: ['hip-hop'],
        payola_flag: true, payola_evidence: 'rapsushiplaylist.com sells $25 playlist adds',
        notes: '"It\'s Goin" playlist. The verified add came through the FREE-submissions route, not the $25 paid funnel (9/20). Payola flag stays on paid adds. Thread closed 2026-09-20 after Black\'s thank-you DM.' }),
    C('watch-tha-gap', 'WATCH THA GAP', 'spotify-playlist',
      { type: 'dm', value: 'Instagram DM @watchthagap (from @lanskyblack)' },
      { handles: ['@watchthagap'], genres: ['hip-hop'],
        notes: 'WATCH THA GAP VOL.5. "Ultimate" pitched 9/14; curator replied 9/15 "I will add you to the list my guy" = consideration list, NOT a placement. Verification follow-up drafted, not sent (exact-copy approval pending per 9/20).' }),
    C('wvua-fm', 'WVUA-FM', 'radio-fm',
      { type: 'unknown', value: 'MP3 delivery route (per 9/15 record)' },
      { notes: 'MP3s delivered per 9/15 record.' }),
    C('cypha-inc', 'Cypha Inc', 'other',
      { type: 'unknown', value: 'MP3 delivery route (per 9/15 record)' },
      { notes: 'MP3s delivered per 9/15 record.' }),
    C('excitement-radio', 'Excitement Radio', 'radio-internet',
      { type: 'unknown', value: 'MP3 delivery route (per 9/15 record)' },
      { notes: 'MP3s delivered per 9/15 record.' }),
    C('pandora-amp', 'Pandora AMP', 'other',
      { type: 'unknown', value: 'AMP claim process (per 9/15 record)' },
      { notes: 'Claim pending per 9/15 record.' }),
    C('stationhead', 'Stationhead', 'other',
      { type: 'unknown', value: 'custom-channel request (per 9/15 record)' },
      { notes: 'Custom-channel request submitted per 9/15 record.' }),
    C('audiartist', 'Audiartist', 'other',
      { type: 'form-url', value: 'audiartist.com submission flow' },
      { notes: 'Round 1 accepted 3/3 on 2026-09-14 ("New Rap Hits", 673 followers). Followup-plan DNC = placed tracks only (G1-enforced); new-track pitches allowed per opportunities #21. Round 2 candidates: "Warped and Wicked", "Flamerz", "Ultimate" — one per submission. Draft: drafted-submissions/10-audiartist-round2.md.' }),
    C('eric-alper', 'Eric Alper', 'spotify-playlist',
      { type: 'email', value: '9/14 outreach email (per followup-plan §9)' },
      { playlist_urls: [PLAYLIST.alper360], genres: ['indie'],
        notes: 'Curates "360° : The Best Indie Music" (216 tracks at verification time).' }),
    // §9 already-contacted 9/14 threads (inbox watch only)
    ...[
      ['obscure-sound', 'Obscure Sound', 'blog'],
      ['unity-radio', 'Unity Radio', 'radio-internet'],
      ['thunderground', 'ThunderGround', 'blog'],
      ['underground-1077', '107.7 The Underground', 'radio-fm'],
      ['cabbages', 'CABBAGES', 'blog'],
      ['snds-radio', 'SNDS Radio', 'radio-internet'],
      ['ofi-monday', 'O.F.I. Monday', 'other'],
      ['live-1051', '105.1 LIVE', 'radio-fm'],
      ['lyrical-lux-fm', 'Lyrical Lux FM', 'radio-internet'],
      ['cypha-indie-radio', 'Cypha Indie Radio', 'radio-internet'],
      ['kice-993-dj-benz', '99.3 KICE / DJ Benz', 'radio-fm'],
      ['midtown-blog-48201', '48201 Midtown Blog', 'blog'],
      ['undrgrnd-magazine', 'UNDRGRND Magazine', 'blog'],
      ['original-hot-boy-turk', 'Original Hot Boy Turk', 'influencer'],
      ['unsigned-artists-showcase', 'Unsigned Artists Showcase', 'other'],
      ['dennis-kane', 'Dennis Kane', 'other'],
      ['r-j', 'R J', 'other'],
      ['illustr3us', 'ILLUSTR3US', 'other'],
    ].map(([id, name, platform]) => C(id, name, platform,
      { type: 'email', value: '9/14 outreach email (per followup-plan §9)' },
      { notes: 'Inbox watch only. Collective review Mon 2026-09-22: any thread silent 8 days gets a single polite bump or is closed (followup-plan §9).' })),
    C('west-hiphop-mag', 'West HipHop Mag', 'blog',
      { type: 'dm', value: 'DM (per followup-plan §9)' },
      { notes: 'Inbox watch only; collective review 2026-09-22. Flagged payola-adjacent in followup-plan (paid upsell) — engage only on free terms.' }),
    // Hard do-not-contact (no live thread follow-up exists) — see S1
    C('elevator', 'ELEVATOR', 'other',
      { type: 'unknown', value: '(already pitched per followup-plan 2026-09-15)' },
      { do_not_contact: true, dnc_reason: 'already pitched — never re-pitch (followup-plan 2026-09-15)',
        notes: 'Radio pipeline 2026-09-15 excluded as pay-to-submit — treat as payola-adjacent.' }),
    C('hype-off-life', 'Hype Off Life', 'blog',
      { type: 'form-url', value: 'submission form (submitted twice 2026-09-14)' },
      { do_not_contact: true, dnc_reason: 'submitted twice 9/14 — do not resubmit (followup-plan 2026-09-15)' }),
    C('mcm_disco', 'mcm_disco', 'influencer',
      { type: 'dm', value: 'Instagram DM (from @lanskyblack) 2026-09-14' },
      { handles: ['@mcm_disco'], do_not_contact: true,
        dnc_reason: "DM'd 2026-09-14, never replied — never re-pitch (followup-plan 2026-09-15)" }),
    C('istashathescrub', 'istashathescrub', 'influencer',
      { type: 'dm', value: 'Instagram DM (from @lanskyblack) 2026-09-14' },
      { handles: ['@istashathescrub'], do_not_contact: true,
        dnc_reason: "DM'd 2026-09-14, never replied — never re-pitch (followup-plan 2026-09-15)" }),
    C('soundplate', 'Soundplate', 'other',
      { type: 'form-url', value: 'soundplate.com (already pitched per followup-plan 2026-09-15)' },
      { do_not_contact: true, dnc_reason: 'already pitched — never re-pitch (followup-plan 2026-09-15)',
        notes: 'CONFLICT: opportunities #16 lists the Soundplate HipHop/Rap free route (https://soundplate.com/submit-music-spotify-playlists/, Spotify login only; draft drafted-submissions/08-soundplate-form.md). New-track submission at operator discretion — parent to rule.' }),
    C('independent-music-broadcast', 'Independent Music Broadcast', 'other',
      { type: 'email', value: '9/14 outreach email' },
      { notes: 'Received the INVALID Spotify link 1sY0hpRVAYMVgTEeDxZgFA on 9/14 — correction message owed 2026-09-16, no new submission attached.' }),
    C('kenny-reactz', 'Kenny Reactz', 'other',
      { type: 'email', value: '9/14 outreach email' },
      { notes: 'Received the INVALID Spotify link 1sY0hpRVAYMVgTEeDxZgFA on 9/14 — correction message owed 2026-09-16, no new submission attached.' }),
  ];
}

// ---------------------------------------------------------------------------
// Section 3: curators — opportunities (submission-opportunities.md)
// ---------------------------------------------------------------------------
function opportunityCurators() {
  const C = (id, name, platform, submission_path, extra = {}) => ({
    id, name, platform, submission_path,
    handles: [], playlist_urls: [], genres: ['hip-hop'], follower_count: null, followers_observed_at: null,
    account_needed: false, payola_flag: false, payola_evidence: null,
    do_not_contact: false, dnc_reason: null,
    stats: { pitches: 0, replies: 0, placements_verified: 0 },
    notes: null, created_at: T(15, '09'), updated_at: T(15, '09'),
    ...extra,
  });
  return [
    C('wort-fm', 'WORT-FM 89.9 Madison, WI', 'radio-fm',
      { type: 'email', value: 'wortfm89.9@gmail.com' },
      { notes: 'Verified live 2026-09-15 (wortfm.org/music-department-contacts). Subject line "Hiphop Music Submission". Accepts FLAC/WAV/high-quality MP3 + one-sheet with FCC-prohibited-content list. Draft: drafted-submissions/01-wort-email.md (explicit-content disclosure included).' }),
    C('kboo-fm', 'KBOO-FM 90.7 Portland, OR', 'radio-fm',
      { type: 'physical-mail', value: 'KBOO Radio, Attn: Brendon Reyes, 20 SE 8th Ave, Portland, OR 97214' },
      { notes: 'Verified live 2026-09-15 (kboo.fm/submit-your-music). Dedicated hip-hop lane (Brendon Reyes). Draft: drafted-submissions/02-kboo-mailer.md; explicit status disclosed.' }),
    C('kdhx', 'KDHX 88.1 St. Louis, MO', 'radio-fm',
      { type: 'email', value: 'digital submissions via station email (kdhx.org "How do I get my music played", verified 2026-09-14)' },
      { notes: 'Full-spectrum community radio; long history of indie/hip-hop digital submissions. Draft: next wave (audio file needed).' }),
    C('radio-laurier', 'Radio Laurier (Canada)', 'radio-fm',
      { type: 'email', value: 'music@radiolaurier.com' },
      { notes: 'Verified live 2026-09-15 (radiolaurier.com/music-submissions). Campus station; accepts downloadable MP3; asks for clean edit where FCC rules are violated — STAGED until clean edit exists (none does). Draft: drafted-submissions/03-radio-laurier-email.md.' }),
    C('blazeradio', 'BlazeRadio — UAB Birmingham', 'radio-internet',
      { type: 'email', value: 'blazeradio@insideuab.com' },
      { notes: 'Verified 2026-09-14. College internet radio; hip-hop friendly; no FCC constraint. Draft: drafted-submissions/04-blazeradio-email.md.' }),
    C('tempo-check-radio', 'Tempo Check Radio — Huntsville, AL', 'radio-internet',
      { type: 'unknown', value: 'broadcaster contact via Live365 profile (verified 2026-09-14)' },
      { notes: 'Internet-only hip-hop/urban station; no FCC constraint. Draft: next wave.' }),
    C('wsum', 'WSUM 91.7 FM — UW Madison, WI', 'radio-fm',
      { type: 'unknown', value: 'contact via station website for submission details (Jan-2026 radio submission directory)' },
      { notes: 'Major student station, hip-hop programming, open submissions. Draft: next wave (exact departmental email to confirm on site visit).' }),
    C('radio-k', 'Radio K (KUOM) — UMN Minneapolis, MN', 'radio-fm',
      { type: 'unknown', value: 'contact via radiok.org for submission details' },
      { notes: 'Dedicated to independent and underground music; regularly accepts new indie submissions. Draft: next wave.' }),
    C('kmsu', 'KMSU Minnesota Music Channel — Mankato, MN', 'radio-fm',
      { type: 'email', value: 'kmsumnmusic@gmail.com (download links, high-quality WAV/MP3; verified 2026-09-15)' },
      { notes: '"All music must be FCC-compliant" — STAGED until clean edit exists (none does). Draft: drafted-submissions/05-kmsu-mn-music-email.md.' }),
    C('siriusxm', 'SiriusXM — national satellite', 'other',
      { type: 'physical-mail', value: 'SiriusXM Music Programming Department, 1221 Avenue of the Americas, New York, NY (verified 2026-09-14)' },
      { notes: 'Satellite = explicit content airs on uncut channels; official unsolicited-submission route. Draft: next wave (needs pressed/audio package).' }),
    C('coast-2-coast-radio', 'Coast 2 Coast Radio', 'radio-internet',
      { type: 'form-url', value: 'https://coast2coastmixtapes.com/submissions/radio/ (verified 2026-09-14)' },
      { notes: 'Urban/mixtape radio for indie hip-hop. Confirm no fee at submit time — page shows no pricing; do NOT submit if a fee appears.' }),
    C('dash-radio', 'Dash Radio', 'radio-internet',
      { type: 'form-url', value: 'free account at Smash Haus, upload 2 song links for Dash rotation (verified 2026-09-14)' },
      { account_needed: true, notes: 'National digital radio network; hip-hop channels; self-serve upload. STAGED — Black approves account creation.' }),
    C('jango', 'Jango Radio Airplay', 'radio-internet',
      { type: 'form-url', value: 'free artist upload at jango.com airplay program (verified 2026-09-14)' },
      { account_needed: true, notes: 'Internet radio airplay marketplace; free tier exists. STAGED — Black approves account creation.' }),
    C('iheart-radio', 'iHeartRadio', 'other',
      { type: 'unknown', value: 'no public form — confirm catalog delivery inside DistroKid dashboard (verified 2026-09-14)' },
      { account_needed: true, notes: 'Black-side checklist item, NOT a submission: confirm the catalog is in iHeart\'s system before any DJ outreach.' }),
    C('dailyplaylists', 'DailyPlaylists', 'other',
      { type: 'form-url', value: 'dailyplaylists.com artist marketplace; curator bids free to enter (verified 2026-09-14)' },
      { account_needed: true, notes: 'Direct-to-playlist-curator bidding; hip-hop curators active. Draft: drafted-submissions/09-dailyplaylists-campaign.md. STAGED — Black approves account creation.' }),
    C('indiemono', 'IndieMono', 'spotify-playlist',
      { type: 'form-url', value: 'https://player.indiemono.com/music-submit/ and https://indiemono.com/submit-music-urban-playlists/ (verified 2026-09-15)' },
      { notes: 'Free, one submission per track, Spotify track required, no sold placement. Draft: drafted-submissions/06-indiemono-form.md.' }),
    C('laurelanne-media', 'Laurelanne.media', 'spotify-playlist',
      { type: 'form-url', value: 'https://laurelanne.media/playlist-submission.html (verified 2026-09-15)' },
      { notes: 'Playlists include HIP-HOP EMPIRE and HYPERPOP; one submission per week; honor-system Spotify save/follow. Draft: drafted-submissions/07-laurelanne-form.md.' }),
    C('submitlink', 'SubmitLink', 'other',
      { type: 'form-url', value: 'https://www.submitlink.io/features/playlist-submissions — FREE campaign route only (verified 2026-09-14)' },
      { account_needed: true, notes: 'Free campaign sends ONE song to TWO eligible playlists; reusable after 24h. Individual curator pages found in search were PAID — use ONLY the free campaign route, never paid curator pages. STAGED — Black approves account creation.' }),
    C('delaynote', 'Delaynote', 'other',
      { type: 'form-url', value: 'https://delaynote.com/ — free account tier unlocks 50 playlists (verified 2026-09-14)' },
      { account_needed: true, notes: 'Directory mixes free and paid opportunities — select FREE-ONLY, ignore paid lanes. STAGED — Black approves account creation.' }),
    C('submithub', 'SubmitHub', 'other',
      { type: 'form-url', value: 'submithub.com — Standard credits only (verified 2026-09-14)' },
      { account_needed: true, notes: 'Standard credits are free (2 per 4 hours); Premium is paid — use Standard ONLY. Response rates are low; treat as volume play, not priority. STAGED — Black approves account creation.' }),
    C('the-digilogue', 'The Digilogue (Highnote Tastemaker Sessions)', 'spotify-playlist',
      { type: 'form-url', value: 'thedigilogue.com/submit (via Highnote, verified 2026-09-15)' },
      { notes: 'Tastemaker-verified Spotify playlists incl. Rapper\'s Delight and Bangers & B-Sides — hip-hop editorial lane. Draft: next wave.' }),
    C('spotify-for-artists', 'Spotify for Artists — editorial pitching', 'other',
      { type: 'form-url', value: 'artists.spotify.com → Upcoming → pitch to editors (free, standard S4A feature)' },
      { account_needed: true, notes: 'The only free route to Spotify\'s own editorial playlists; every priority track should be pitched. Black\'s S4A access — Black-side checklist item.' }),
    C('konrad-oldmoney', 'Konrad OldMoney', 'influencer',
      { type: 'unknown', value: 'IG profile behind found.ee redirect (from 2026-09-14 playlist research)' },
      { notes: 'Cyberpunk Rap/HipHop playlists; niche aesthetic fit for Post-Trap Futurism. NOT actionable yet — needs browser delegation to resolve the IG/contact route; queued for parent\'s browser task.' }),
  ];
}

// ---------------------------------------------------------------------------
// Section 4: pitches, follow-ups, placements, verification events
// ---------------------------------------------------------------------------
function addPitch(store, spec, opts = {}) {
  validatePitchNew(store, { curator_id: spec.curator_id, track_ids: spec.track_ids, channel: spec.channel }, opts);
  const recs = store.records('pitches');
  const pitch = {
    id: genId(recs, 'pch', new Date(spec.created_at)),
    curator_id: spec.curator_id, track_ids: spec.track_ids, channel: spec.channel,
    status: spec.status || 'draft',
    messages: [],
    next_action_date: spec.next_action_date || null,
    next_action: spec.next_action || null,
    nudges_used: spec.nudges_used || 0,
    last_nudge_at: spec.last_nudge_at || null,
    retired_reason: spec.retired_reason || null,
    created_at: spec.created_at,
    closed_at: spec.closed_at || null,
  };
  for (const m of (spec.messages || [])) validateMessage(m, pitch, new Date('2026-09-21T00:00:00Z'));
  pitch.messages = spec.messages || [];
  store.insert('pitches', pitch);
  const c = store.find('curators', spec.curator_id);
  bumpStat(c, 'pitches');
  if ((spec.messages || []).some(m => m.direction === 'in')) bumpStat(c, 'replies');
  store.update('curators', c.id, { stats: c.stats, updated_at: c.updated_at });
  return pitch;
}

function addFollowup(store, spec) {
  const recs = store.records('followups');
  const f = {
    id: genId(recs, 'fup', new Date(spec.due_date + 'T00:00:00Z')),
    pitch_id: spec.pitch_id, due_date: spec.due_date, action: spec.action,
    done: !!spec.done, done_at: spec.done_at || null, result: spec.result || null,
  };
  validateFollowup(store, f);
  store.insert('followups', f);
  return f;
}

function writeReceipt(store, filename, body) {
  store.ensureDirs();
  const p = join(store.receiptsDir, filename);
  writeFileSync(p, body, 'utf8');
  return p;
}

function addPlacement(store, spec) {
  const receiptPath = writeReceipt(store, spec.receipt_file, spec.receipt_body);
  const recs = store.records('placements');
  const p = {
    id: genId(recs, 'plc', new Date(spec.observed_at)),
    pitch_id: spec.pitch_id, curator_id: spec.curator_id, track_id: spec.track_id,
    playlist_url: spec.playlist_url, position: spec.position, total_tracks: spec.total_tracks,
    verified_via: spec.verified_via, observed_at: spec.observed_at, live: true,
    receipts: [receiptPath],
  };
  validatePlacement(store, p);
  store.insert('placements', p);
  const c = store.find('curators', spec.curator_id);
  bumpStat(c, 'placements_verified');
  store.update('curators', c.id, { stats: c.stats, updated_at: c.updated_at });
  // Verification event for the placement (method=manual: operator-attested corpus evidence).
  const verRecs = store.records('verifications');
  const ev = {
    id: genId(verRecs, 'ver', new Date(spec.observed_at)),
    placement_id: p.id, playlist_url: spec.playlist_url, track_id: spec.track_id,
    observed_at: spec.observed_at, found: true, position: spec.position,
    total_tracks: spec.total_tracks, method: 'manual', raw_log_path: receiptPath,
  };
  validateVerificationEvent(ev);
  store.insert('verifications', ev);
  return { placement: p, event: ev };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
export function seedCorpus(store, { now = new Date() } = {}) {
  const summary = { tracks: 0, curators: 0, pitches: 0, followups: 0, placements: 0, verification_events: 0 };

  // 1. tracks
  for (const t of TRACKS) {
    const rec = {
      id: t.id, title: t.title, artist: 'That Boy Hi Hat',
      spotify_url: `https://open.spotify.com/track/${t.url}`,
      isrc: null, explicit: true, fcc_safe: false, release_date: t.release_date || null,
    };
    validateTrack(rec); // V6
    store.insert('tracks', rec);
    summary.tracks++;
  }

  // 2. curators (threads + opportunities; audiartist/soundplate merge with thread records)
  const seen = new Set();
  const allCurators = [...threadCurators(), ...opportunityCurators()];
  for (const c of allCurators) {
    if (seen.has(c.id)) continue; // audiartist + soundplate already seeded from threads
    seen.add(c.id);
    validateCurator(c);
    store.insert('curators', c);
    summary.curators++;
  }

  const P = {}; // named pitch handles

  // Thread 1 — Hip-Hop High Society (acknowledged; check-ins 9/28 + 10/05)
  P.hhs = addPitch(store, {
    curator_id: 'hip-hop-high-society', track_ids: ['zooted-zone'], channel: 'form',
    status: 'acknowledged', created_at: T(14, '12'),
    messages: [
      msg(T(14, '12'), 'out', 'Web-form submission of Zooted Zone via https://hiphophighsociety.com/music-submissions/ (exact form text not retained in corpus)', CWI),
      msg(T(14, '18'), 'in', 'RECEIVED — TRACK\'S IN', 'Hip-Hop High Society'),
    ],
    next_action_date: '2026-09-28',
    next_action: 'ONE polite check-in via site contact — do NOT resubmit the form',
  });
  addFollowup(store, { pitch_id: P.hhs.id, due_date: '2026-09-28',
    action: 'ONE polite check-in via site contact — do NOT resubmit the form. Draft (for Black\'s approval): \'Hi — following up on my Zooted Zone submission from Sept 14 ("received — track\'s in"). Any update on the review? Happy to send anything else you need. — Cumulative Web Inc, hp@cumulativeweb.com\'' });
  addFollowup(store, { pitch_id: P.hhs.id, due_date: '2026-10-05',
    action: 'If no reply after the 9/28 check-in: one final nudge, then close the thread and move on.' });
  summary.pitches++; summary.followups += 2;

  // Thread 2 — Flow / No Label Needed (claimed add, UNVERIFIED per 9/15 corpus)
  P.flow = addPitch(store, {
    curator_id: 'flow-no-label-needed', track_ids: ['zooted-zone'], channel: 'ig-dm',
    status: 'replied', created_at: T(14, '12'),
    messages: [
      msg(T(14, '14'), 'out', 'IG DM pitch of Zooted Zone to @flowdigonthetrack (exact text not retained in corpus)', BLACK_IG, APPROVAL_REF),
      msg(T(14, '15'), 'in', 'Got u!! (+ playlist link and reaction)', 'Flow (@flowdigonthetrack)'),
    ],
    next_action_date: '2026-09-16',
    next_action: 'verification nudge — claimed add still unverified',
  });
  addFollowup(store, { pitch_id: P.flow.id, due_date: '2026-09-16',
    action: 'ONE polite verification nudge (from Black\'s account). History: two full playlist scans on 9/15 found NO That Boy Hi Hat track — claimed add UNVERIFIED. Draft (for Black\'s approval): \'Appreciate you looking out — quick check, I scanned the playlist and couldn\'t find Zooted Zone on there yet. Sometimes Spotify caches slow. Mind confirming it\'s live on your end? Link I sent: https://open.spotify.com/track/0emH8ktA8x4DkOFLsG5xkW\'. If still absent after 48h: report as unverified, do not count as a placement, no further nudges.' });
  summary.pitches++; summary.followups++;

  // Thread 3 — DJ 6Rings / It's Goin (HISTORICAL: predates the payola flag; frozen per V1)
  P.rings = addPitch(store, {
    curator_id: 'shan-dj-6rings', track_ids: ['flex-my-flame'], channel: 'ig-dm',
    status: 'closed', retired_reason: 'placed — thank-you DM sent by Black 2026-09-20; thread closed',
    created_at: T(14, '12'), closed_at: T(20, '12'),
    messages: [
      msg(T(14, '16'), 'out', 'IG DM pitch of Flex My Flame to @dj6rings (exact text not retained in corpus)', BLACK_IG, APPROVAL_REF),
      msg(T(14, '21'), 'in', 'Bet added to this playlist (+ Spotify link for "It\'s Goin", 21:18 EDT)', 'Shan / DJ 6Rings'),
      msg(T(20, '10'), 'out', 'Thank-you DM for the verified It\'s Goin add (exact text not retained in corpus; sent by Black 2026-09-20)', 'Black (@lanskyblack)', APPROVAL_REF),
    ],
  }, { historical: true });
  summary.pitches++;

  // Thread 4 — WATCH THA GAP VOL.5 (replied; consideration list, NOT placed)
  P.wtg = addPitch(store, {
    curator_id: 'watch-tha-gap', track_ids: ['ultimate'], channel: 'ig-dm',
    status: 'replied', created_at: T(14, '12'),
    messages: [
      msg(T(14, '17'), 'out', 'IG DM pitch of Ultimate to @watchthagap for WATCH THA GAP VOL.5 (exact text not retained in corpus)', BLACK_IG, APPROVAL_REF),
      msg(T(15, '03'), 'in', 'I will add you to the list my guy.', 'WATCH THA GAP (@watchthagap)'),
    ],
    next_action_date: '2026-09-17',
    next_action: 'locate playlist / scan / polite nudge',
  });
  addFollowup(store, { pitch_id: P.wtg.id, due_date: '2026-09-17',
    action: '(a) locate the playlist via Spotify search; (b) if found, full scan for Ultimate; (c) if absent, ONE polite nudge. Draft (for Black\'s approval): \'Hey, checking in on that "Ultimate" add for WATCH THA GAP VOL.5 — couldn\'t find the playlist in search. Got a direct link? Track: https://open.spotify.com/track/2daugr3ni3r6jHH6UI57EK (Ultimate URL from the AI learning kit; the followup-plan said confirm with Black before sending)\'. Status: consideration list, NOT a placement.' });
  summary.pitches++; summary.followups++;

  // Thread 5 — MP3 recipients (3 stations)
  for (const cid of ['wvua-fm', 'cypha-inc', 'excitement-radio']) {
    const p = addPitch(store, {
      curator_id: cid, track_ids: ['zooted-zone'], channel: 'email',
      status: 'sent', created_at: T(15, '10'),
      messages: [msg(T(15, '10'), 'out', 'MP3 delivery (exact text not retained in corpus; delivered per 9/15 record)', CWI)],
      next_action_date: '2026-09-22',
      next_action: 'inbox check; if silent, ONE polite confirmation email',
    });
    addFollowup(store, { pitch_id: p.id, due_date: '2026-09-22',
      action: 'Check inboxes for replies; if silent, ONE polite confirmation email: \'Just confirming the MP3s landed and seeing if there\'s a timeline for airplay consideration. Happy to send anything else. — hp@cumulativeweb.com\'' });
    summary.pitches++; summary.followups++;
  }

  // Thread 6 — Pandora AMP (draft)
  P.pandora = addPitch(store, {
    curator_id: 'pandora-amp', track_ids: ['zooted-zone'], channel: 'other',
    status: 'draft', created_at: T(15, '11'),
    next_action_date: '2026-09-16',
    next_action: 'check AMP claim status',
  });
  addFollowup(store, { pitch_id: P.pandora.id, due_date: '2026-09-16',
    action: 'Check AMP claim status; if still pending, follow Pandora\'s stated process once, then park it.' });
  summary.pitches++; summary.followups++;

  // Thread 7 — Stationhead (sent)
  P.stationhead = addPitch(store, {
    curator_id: 'stationhead', track_ids: ['zooted-zone'], channel: 'other',
    status: 'sent', created_at: T(15, '11'),
    messages: [msg(T(15, '11'), 'out', 'Custom-channel request submitted (exact text not retained in corpus)', CWI)],
    next_action_date: '2026-09-16',
    next_action: 'check request status; document outcome in the intelligence log',
  });
  addFollowup(store, { pitch_id: P.stationhead.id, due_date: '2026-09-16',
    action: 'Check custom-channel request status; document outcome in the intelligence log.' });
  summary.pitches++; summary.followups++;

  // Thread 8 — Audiartist round 1 (3 pitches, all placed via scan)
  const audSubs = [
    ['zooted-zone', '25818', 30],
    ['doves-diamonds', '25820', 31],
    ['shaka-zulu', '25821', 21],
  ];
  const audPitches = [];
  for (const [tid, sub, pos] of audSubs) {
    const p = addPitch(store, {
      curator_id: 'audiartist', track_ids: [tid], channel: 'form',
      status: 'placed', created_at: T(14, '12'),
      messages: [msg(T(14, '12'), 'out', `Audiartist free submission #${sub} — ${tid} (exact form text not retained in corpus)`, CWI)],
    });
    audPitches.push(p);
    summary.pitches++;
    const { placement } = addPlacement(store, {
      pitch_id: p.id, curator_id: 'audiartist', track_id: tid,
      playlist_url: PLAYLIST.newRapHits, position: pos, total_tracks: 105,
      verified_via: 'scan', observed_at: T(15, '12'),
      receipt_file: `plc_audiartist_${tid}.md`,
      receipt_body:
`# Placement receipt — Audiartist "New Rap Hits"
- placement: ${tid} at #${pos}/105
- playlist: ${PLAYLIST.newRapHits}
- verified_via: scan (full 105-track playlist scan, 2026-09-15)
- submission: Audiartist free submission #${sub} (round 1, accepted 2026-09-14)
- source: submission-opportunities.md #21 + playlist-intel scan 2026-09-15
`,
    });
    summary.placements++; summary.verification_events++;
  }
  P.audRound2 = addPitch(store, {
    curator_id: 'audiartist', track_ids: ['warped-and-wicked'], channel: 'form',
    status: 'draft', created_at: T(15, '12'),
    next_action_date: '2026-09-16', next_action: 'round-2 staging: one submission per track (Warped and Wicked, Flamerz, Ultimate)',
  });
  // NOTE: this draft pitch is the round-2 staging placeholder per opportunities #21
  // (a draft exists: drafted-submissions/10-audiartist-round2.md). Nothing sent.
  // The round-1 curator-notes check belongs to the placed threads:
  addFollowup(store, { pitch_id: audPitches[0].id, due_date: '2026-09-16',
    action: 'Check Audiartist dashboard for curator notes on the three accepted submissions; log notes verbatim. Do NOT resubmit the three placed tracks.' });
  summary.pitches++; summary.followups++;

  // Thread 9 — §9 already-contacted threads (19 pitches + Eric Alper)
  const s9 = ['obscure-sound', 'unity-radio', 'thunderground', 'underground-1077', 'cabbages',
    'snds-radio', 'ofi-monday', 'live-1051', 'lyrical-lux-fm', 'cypha-indie-radio',
    'kice-993-dj-benz', 'midtown-blog-48201', 'undrgrnd-magazine', 'original-hot-boy-turk',
    'unsigned-artists-showcase', 'dennis-kane', 'r-j', 'illustr3us', 'west-hiphop-mag'];
  for (const cid of s9) {
    addPitch(store, {
      curator_id: cid, track_ids: ['zooted-zone'], channel: cid === 'west-hiphop-mag' ? 'other' : 'email',
      status: 'sent', created_at: T(14, '12'),
      messages: [msg(T(14, '12'), 'out', '9/14 outreach (exact text not retained in corpus; thread live per followup-plan §9)', CWI)],
      next_action_date: '2026-09-22',
      next_action: 'collective §9 review: silent 8 days → single polite bump or close',
    });
    summary.pitches++;
  }
  // Eric Alper — placed via curator reply 2026-09-17
  P.alper = addPitch(store, {
    curator_id: 'eric-alper', track_ids: ['zooted-zone'], channel: 'email',
    status: 'placed', created_at: T(14, '12'),
    messages: [
      msg(T(14, '12'), 'out', '9/14 outreach email (exact text not retained in corpus; thread live per followup-plan §9)', CWI),
      msg(T(17, '12'), 'in', 'Curator reply confirming the add (exact text not retained in corpus; reply 2026-09-17 per VERIFICATION-METHOD.md)', 'Eric Alper'),
    ],
  });
  summary.pitches++;
  addPlacement(store, {
    pitch_id: P.alper.id, curator_id: 'eric-alper', track_id: 'zooted-zone',
    playlist_url: PLAYLIST.alper360, position: 216, total_tracks: 216,
    verified_via: 'link', observed_at: T(17, '12'),
    receipt_file: 'plc_eric-alper_zooted-zone.md',
    receipt_body:
`# Placement receipt — Eric Alper "360° : The Best Indie Music"
- placement: zooted-zone at #216/216
- playlist: ${PLAYLIST.alper360}
- verified_via: link (curator reply 2026-09-17 confirming the add)
- evidence: curator's reply; position captured from playlist at verification time
- source: VERIFICATION-METHOD.md V-4 (K6 known-good placement)
- note: the 2026-09-20 sweep later showed Zooted Zone at #168/198 after a playlist
  trim, plus a new verified add (Rainbows And Roses #169/198) — both outside the
  frozen seed corpus; re-run \`setlist verify\`/\`rescan\` to capture drift.
`,
  });
  summary.placements++; summary.verification_events++;

  // DJ 6Rings placement (verified 2026-09-20 via the curator's own link, free route)
  addPlacement(store, {
    pitch_id: P.rings.id, curator_id: 'shan-dj-6rings', track_id: 'flex-my-flame',
    playlist_url: PLAYLIST.itsGoin, position: 7, total_tracks: 40,
    verified_via: 'link', observed_at: T(20, '10'),
    receipt_file: 'plc_6rings_flex-my-flame.md',
    receipt_body:
`# Placement receipt — DJ 6Rings "It's Goin"
- placement: flex-my-flame at #7/40
- playlist: ${PLAYLIST.itsGoin}
- verified_via: link (the curator's own link, supplied in the IG DM thread 2026-09-14 21:18 EDT)
- route: FREE-submissions route — NOT the $25 paid funnel (payola flag stays on paid adds only)
- verification: fresh Spotify API read 2026-09-20 found spotify:track:3knXIxd0PlraXvarlwGwKm at #7
- honesty notes:
  - total_tracks=40 is the K6 fixture snapshot count (synthetic stand-in); the corpus
    never captured the real playlist length. Re-run \`setlist verify\` with a live
    snapshot to replace it.
  - the AI learning kit lists a different upload of Flex My Flame
    (7FQvcCS2CdTVsd6hb9jvHx); this placement is verified against 3knXIxd0PlraXvarlwGwKm
    (possible duplicate upload — flagged, not resolved).
- source: memory/2026-09-20.md (05:18–05:32 EDT playlist sweep)
`,
  });
  summary.placements++; summary.verification_events++;

  // Thread 10 — invalid-link corrections (2 curators)
  for (const cid of ['independent-music-broadcast', 'kenny-reactz']) {
    const p = addPitch(store, {
      curator_id: cid, track_ids: ['zooted-zone'], channel: 'email',
      status: 'sent', created_at: T(14, '12'),
      messages: [msg(T(14, '12'), 'out', '9/14 outreach email — NOTE: carried the INVALID Spotify link 1sY0hpRVAYMVgTEeDxZgFA (exact text not retained in corpus)', CWI)],
      next_action_date: '2026-09-16',
      next_action: 'ONE careful correction message — no new submission attached',
    });
    addFollowup(store, { pitch_id: p.id, due_date: '2026-09-16',
      action: 'ONE careful correction message, NO new submission attached (resubmitting blindly = duplicate spam). Draft (for Black\'s exact-text approval): \'Quick correction on my last message — I sent a broken Spotify link. The working link for "Zooted Zone" is https://open.spotify.com/track/0emH8ktA8x4DkOFLsG5xkW. Sorry about that — no need to re-review anything, just wanted you to have the right one.\'' });
    summary.pitches++; summary.followups++;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf('--dir');
  const root = dirFlag === -1 ? HERE : args[dirFlag + 1];
  const force = args.includes('--force');
  const store = new Store(root);
  const marker = join(store.dataDir, '.seeded.json');
  if (existsSync(marker) && !force) {
    console.error('refusing: this store is already seeded (data/.seeded.json exists). Use --force to reseed.');
    process.exit(1);
  }
  try {
    const summary = seedCorpus(store);
    store.ensureDirs();
    writeFileSync(marker, JSON.stringify({ seeded_at: utcNow(), seed: 'dogfood-corpus-2026-09-15', summary }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } catch (e) {
    console.error(`seed failed: ${e.message}`);
    process.exit(1);
  }
}

export { TRACKS, TID, PLAYLIST };
