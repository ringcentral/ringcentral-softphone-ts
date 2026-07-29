import Softphone, { type InboundInvite } from "ringcentral-softphone";

// @ts-expect-error Softphone is available only as the default runtime export.
import { Softphone as NamedSoftphone } from "ringcentral-softphone";
// @ts-expect-error The old option type spelling has no compatibility alias.
import type { SoftPhoneOptions } from "ringcentral-softphone";
// @ts-expect-error SIP implementation types are not root exports.
import type { InboundMessage } from "ringcentral-softphone";
// @ts-expect-error RTP implementation types are not root exports.
import type { RtpPacket } from "ringcentral-softphone";
// @ts-expect-error The package exposes only its root entry point.
import InternalCallSession from "ringcentral-softphone/call-session/index";

void NamedSoftphone;
void InternalCallSession;

declare const softphone: Softphone;
declare const invite: InboundInvite;

// @ts-expect-error Softphone implementation state is not a supported declaration.
softphone.sipInfo;
// @ts-expect-error Internal SDP generation is not a supported declaration.
softphone.createSdp(4000);
// @ts-expect-error Private implementation state remains inaccessible.
softphone.connected;
// @ts-expect-error SIP parser fields are not part of the opaque invite type.
invite.subject;
// @ts-expect-error SIP headers are not part of the opaque invite type.
invite.headers;
