import { describe, expect, it } from 'vitest';

import { parseAprsLine } from '../aprs.js';

/**
 * Every line here was captured from the live network over the Nebelhorn on 2026-07-29 by
 * `tools/ogn/spike.py`. Nothing is synthesised except the two privacy cases, which need bits that
 * no pilot happened to be setting at the time.
 *
 * Real traffic rather than fixtures from the wiki, because the two assumptions this parser was
 * originally going to make were both wrong, and only real data showed it.
 */

const FANET_PARAGLIDER =
  'FNT1164F8>OGNFNT,qAS,EDMC:/132950h4723.95N/01019.95Eg276/010/A=007416 !W57! id1E1164F8 +374fpm FNT11 sF1 cr1 -3.8dB -24.6kHz';

const FLARM_SAME_PARAGLIDER =
  'FLR1164F8>OGFLR,qAS,Agathazel:/132951h4723.95N/01019.95Eg309/010/A=007855 !W64! id1E1164F8 +257fpm +14.9rot 2.8dB 3e -17.1kHz gps1x2';

const FLARM_GLIDER =
  "FLRDD97C7>OGFLR7,qAS,LOIR:/132951h4727.76N/01042.78E'004/048/A=004735 !W75! id06DD97C7 -157fpm -6.4rot 20.5dB -2.2kHz gps3x5";

const RECEIVER_POSITION =
  'LOIR>OGNSDR,TCPIP*,qAC,GLIDERN3:/133014h4728.27NI01041.49E&/A=002805 antenna: ';

const RECEIVER_STATUS =
  'LOIR>OGNSDR,TCPIP*,qAC,GLIDERN3:>133014h v0.3.3.arm64 CPU:0.8 RAM:337.4/950.0MB NTP:0.7ms';

describe('parseAprsLine', () => {
  it('reads a FANET paraglider beacon', () => {
    const report = parseAprsLine(FANET_PARAGLIDER);

    expect(report).not.toBeNull();
    expect(report.deviceId).toBe('1164F8');
    expect(report.aircraftType).toBe('paraglider');
    expect(report.addressType).toBe('flarm');

    // 4723.95 N with the !W5! third digit → 47° 23.955′
    expect(report.lat).toBeCloseTo(47 + 23.955 / 60, 6);
    expect(report.lon).toBeCloseTo(10 + 19.957 / 60, 6);

    expect(report.altM).toBeCloseTo(7416 * 0.3048, 3);
    expect(report.climbMs).toBeCloseTo(374 * 0.00508, 4);
    expect(report.groundMs).toBeCloseTo(10 * 0.514444, 4);
    expect(report.courseDeg).toBe(276);
    expect(report.timeS).toBe(13 * 3600 + 29 * 60 + 50);
  });

  /**
   * The finding that reshaped the parser. PLAN §5.3 says paragliders transmit FANET, which is true
   * — but they mostly *arrive* decoded by a FLARM receiver, under an `FLR` callsign. Typing them by
   * that prefix would have dropped four of the seven paragliders that were airborne during the
   * spike, on a paragliding app.
   */
  it('types a paraglider as a paraglider even when it arrives under an FLR callsign', () => {
    const report = parseAprsLine(FLARM_SAME_PARAGLIDER);

    expect(report.source).toBe('FLR');
    expect(report.aircraftType).toBe('paraglider');
    expect(report.deviceId).toBe('1164F8');
  });

  it('gives the same device id to both relays of one aircraft', () => {
    // Which is what lets `traffic.js` avoid drawing this paraglider twice, 134 m apart.
    expect(parseAprsLine(FANET_PARAGLIDER).deviceId).toBe(parseAprsLine(FLARM_SAME_PARAGLIDER).deviceId);
  });

  it('reads the aircraft type nibble for a sailplane', () => {
    const report = parseAprsLine(FLARM_GLIDER);
    expect(report.aircraftType).toBe('glider');
    expect(report.climbMs).toBeLessThan(0);
    expect(report.turnRate).toBeCloseTo(-6.4, 5);
  });

  it('applies the !W..! precision enhancement', () => {
    // Without it the position quantises to 1/100 of a minute — about 18 m, which is a visible
    // stair-step along a glider's own trail on a 3D map.
    const withEnhancement = parseAprsLine(FANET_PARAGLIDER);
    const withoutEnhancement = parseAprsLine(FANET_PARAGLIDER.replace(' !W57!', ''));

    expect(withEnhancement.lat).not.toBe(withoutEnhancement.lat);
    expect(Math.abs(withEnhancement.lat - withoutEnhancement.lat) * 111_320).toBeGreaterThan(1);
  });

  it('ignores ground stations and server comments', () => {
    expect(parseAprsLine(RECEIVER_POSITION)).toBeNull();
    expect(parseAprsLine(RECEIVER_STATUS)).toBeNull();
    expect(parseAprsLine('# aprsc 2.1.20-gf.5-g0178a1b')).toBeNull();
    expect(parseAprsLine('')).toBeNull();
  });

  it('surfaces the in-band no-track and stealth flags', () => {
    // 0x40 is the no-tracking bit, 0x80 is stealth. Both keep their aircraft type bits; here that
    // is 7 (paraglider) and address type 2 (FLARM), i.e. 0x1E with the flag added.
    const noTrack = parseAprsLine(FANET_PARAGLIDER.replace('id1E1164F8', 'id5E1164F8'));
    const stealth = parseAprsLine(FANET_PARAGLIDER.replace('id1E1164F8', 'id9E1164F8'));

    expect(noTrack.noTrack).toBe(true);
    expect(noTrack.aircraftType).toBe('paraglider');
    expect(stealth.stealth).toBe(true);
  });
});
