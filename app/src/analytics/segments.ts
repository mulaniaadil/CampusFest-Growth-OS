// Audience segments a campaign can target, defined only from workbook fields.
import type { Model } from './model'
import { attendedBy, recoveryPools, registeredBy, type Scope } from './metrics'
import { statusAt, UNATTRIBUTED } from './model'

export interface AudienceSegment { key: string; label: string; size: number | null; definition: string }

export function audienceSegments(m: Model, s: Scope): AudienceSegment[] {
  const E = s.end
  const pools = recoveryPools(m, { ...s, campaignIds: null })
  const ext = m.external.filter((p) => p.firstSeen <= E)
  const confirmed = ext.filter((p) => registeredBy(p, E) && statusAt(p.reg!, E) === 'confirmed')
  const brochureNoReg = ext.filter((p) => !registeredBy(p, E) && (p.firstAt['brochure_download'] ?? Infinity) <= E && !((p.firstAt['opted_out'] ?? Infinity) <= E))
  const attendees = ext.filter((p) => attendedBy(p, E) && p.campaignId !== UNATTRIBUTED)
  return [
    { key: 'confirmed_registrants', label: 'Confirmed registrants', size: confirmed.length, definition: 'Latest status = confirmed' },
    { key: 'form_abandoners', label: 'Form abandoners (contactable)', size: pools.formAbandonersContactable, definition: 'Identified registration_start, no registration, not opted out' },
    { key: 'waitlisted', label: 'Waitlisted registrants', size: pools.waitlisted, definition: 'Latest status = waitlisted' },
    { key: 'stuck_interested', label: 'Registrations stuck at "interested"', size: pools.stuckInterested, definition: 'Latest status = interested' },
    { key: 'cancelled', label: 'Cancelled registrants (win-back)', size: pools.cancelled, definition: 'Latest status = cancelled' },
    { key: 'brochure_no_reg', label: 'Brochure downloaders without registration', size: brochureNoReg.length, definition: 'brochure_download, no registration, not opted out' },
    { key: 'attendees_referral_seed', label: 'Verified attendees (referral seed)', size: attendees.length, definition: 'Campaign-acquired people with a verified admission' },
    { key: 'new_audience', label: 'New audience (not in workbook)', size: null, definition: 'Prospects outside the identified base — size unknown' },
  ]
}
