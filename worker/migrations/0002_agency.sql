-- The SAMPLE agency, its zones and funders. Workers and clients come from POST /api/test/reset (src/sample.js).
-- PIN 4826 as PBKDF2-SHA256, 100 000 iterations, random 16-byte salt (tools/hash-pin.mjs). Change it after setup.
-- src/sample.js reseeds the same row on reset; tests/unit.test.mjs checks the two agree and that this hash really is 4826.
INSERT INTO agency (id, name, office_phone, timezone, office_label, office_lat, office_lng, pin_hash, pin_salt, pin_iterations) VALUES (
  1,
  'SAMPLE Exploits Home Support (demo)',
  '709-555-0100',
  'America/St_Johns',
  'SAMPLE office, Grand Falls-Windsor',
  48.964,
  -55.66444,
  'HL0CykjsPuFaSAXK69aAa30EgjVIx27twS5K1yQtMrg=',
  'iyOxbAJBo7Emc5z1pg1gxg==',
  100000
);

INSERT INTO zones (id, name) VALUES
  (1, 'Grand Falls-Windsor'),
  (2, 'Bishop''s Falls & Norris Arm'),
  (3, 'Botwood, Peterview & Northern Arm');

INSERT INTO funders (id, name) VALUES
  (1, 'SAMPLE Regional home support program'),
  (2, 'Private pay (SAMPLE)'),
  (3, 'SAMPLE Veterans program');
