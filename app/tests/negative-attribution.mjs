// Negative control (m): the copy's Clients map leaves the OpenFreeMap attribution off. office.spec's Clients map test must go red.
import path from 'node:path';
import { control, replaceOnce } from './negative-lib.mjs';

process.exit(control({
  name: 'attribution',
  what: 'office/clients.js leaves the OpenFreeMap attribution off the map',
  args: ['office.spec.mjs', '--project', 'chromium-390', '-g', 'the OpenFreeMap attribution and its three links'],
  breakIt: copy => replaceOnce(path.join(copy, 'app', 'public', 'office', 'clients.js'),
    '  map.attributionControl.addAttribution(MAP_ATTRIBUTION);',
    '  // NEGATIVE CONTROL (m): no attribution'),
}));
