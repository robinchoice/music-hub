import { api } from '$lib/api/client.js';
import { openPass, type Person, type Review, type ReviewVerdict, type TrackComment } from '$lib/utils/track.js';

type Feedback = { comments: TrackComment[]; reviews?: Review[]; waiting?: Person[]; uploader?: { id: string; name: string } | null };

/**
 * The comments and feedback of the selected version, with the comments carried over from its predecessor.
 * Every change goes to the API and loads the lists again; a later load wins over an earlier one, so
 * switching versions quickly never mixes them. The page keeps toasts and the version list.
 */
export class TrackComments {
  comments = $state<TrackComment[]>([]);
  /** Comments of the predecessor, shown as carried over */
  carry = $state<TrackComment[]>([]);
  /** Finished listening passes on the version, the approvers still missing, and who uploaded it */
  reviews = $state<Review[]>([]);
  waiting = $state<Person[]>([]);
  uploader = $state<{ id: string; name: string } | null>(null);

  #versionId: string | null = null;
  #carryId: string | null = null;
  #seq = 0;
  #onChanged: () => unknown;

  /** onChanged runs after every change, e.g. to refresh the comment counts on the version list */
  constructor(onChanged: () => unknown = () => {}) {
    this.#onChanged = onChanged;
  }

  /** The lists of a version and its predecessor; only the latest call applies its answer */
  async load(versionId: string, carryId: string | null) {
    this.#versionId = versionId;
    this.#carryId = carryId;
    const seq = ++this.#seq;
    const [res, carry] = await Promise.all([
      api.get<Feedback>(`/comments/version/${versionId}`),
      carryId
        ? api.get<{ comments: TrackComment[] }>(`/comments/version/${carryId}?commentsOnly=true`, true).catch(() => ({ comments: [] as TrackComment[] }))
        : Promise.resolve({ comments: [] as TrackComment[] }),
    ]);
    if (seq !== this.#seq) return;
    this.comments = res.comments;
    this.reviews = res.reviews ?? [];
    this.waiting = res.waiting ?? [];
    this.uploader = res.uploader ?? null;
    this.carry = carry.comments;
  }

  /** Offline with cached audio: nothing to show */
  clear() {
    ++this.#seq;
    this.#versionId = null;
    this.#carryId = null;
    this.comments = [];
    this.carry = [];
    this.reviews = [];
    this.waiting = [];
    this.uploader = null;
  }

  /** After a change here or elsewhere (SSE): the lists again, then whoever listens */
  reload = async () => {
    if (this.#versionId) await this.load(this.#versionId, this.#carryId);
    await this.#onChanged();
  };

  /** The user's comments since their last "Fertig" */
  passOf(userId: string) {
    return openPass(this.comments, this.reviews, userId);
  }

  add = async (body: string, timestamp: number | null) => {
    if (!this.#versionId) return;
    await api.post(`/comments/version/${this.#versionId}`, { body, timestampSeconds: timestamp ?? undefined });
    await this.reload();
  };

  /** A reply, on the version or on the carried-over comment of its predecessor */
  reply = async (parentId: string, body: string, onCarry: boolean) => {
    const target = onCarry ? this.#carryId : this.#versionId;
    if (!target) return;
    await api.post(`/comments/version/${target}`, { body, parentId });
    await this.reload();
  };

  resolve = async (id: string) => {
    await api.post(`/comments/${id}/resolve`);
    await this.reload();
  };

  reopen = async (id: string) => {
    await api.post(`/comments/${id}/reopen`);
    await this.reload();
  };

  react = async (id: string, emoji: string) => {
    await api.post(`/comments/${id}/reactions`, { emoji });
    await this.reload();
  };

  edit = async (id: string, body: string) => {
    await api.patch(`/comments/${id}`, { body });
    await this.reload();
  };

  /** Into the project's trash; restore brings it back from there */
  remove = async (id: string) => {
    await api.delete(`/comments/${id}`);
    await this.reload();
  };

  restore = async (id: string) => {
    await api.post(`/trash/comment/${id}/restore`);
    await this.reload();
  };

  /** "Fertig mit V4": the verdict closes the user's pass and goes to the uploader in one message */
  finish = async (verdict: ReviewVerdict, note: string) => {
    if (!this.#versionId) return;
    await api.post(`/versions/${this.#versionId}/reviews`, { verdict, note: note || undefined });
    await this.reload();
  };
}
