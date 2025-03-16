import {jest} from '@jest/globals';

import * as config from '../lib/config.js';
/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

test('loadConfigurationMap should map keys and load them', () => {
    expect(config.loadConfigurationMap(['a', 'b', 'c'], (k) => `value of ${k}`, (k) => `prefix.${k}.suffix`))
        .toEqual(
            new Map([
                ['a', new Map([
                    ['key', 'prefix.a.suffix'],
                    ['value', 'value of prefix.a.suffix']
                ])],
                ['b', new Map([
                    ['key', 'prefix.b.suffix'],
                    ['value', 'value of prefix.b.suffix']
                ])],
                ['c', new Map([
                    ['key', 'prefix.c.suffix'],
                    ['value', 'value of prefix.c.suffix']
                ])]
            ])
        );
});

test('loadConfigurationMap should map empty list of keys to empty map', () => {
    expect(config.loadConfigurationMap([], (k) => `value of ${k}`, (k) => `prefix.${k}.suffix`))
        .toEqual(new Map());
});

test('createKeyPrefixer with default separator should map keys with a dotted prefix', () => {
    expect(['a', 'b']
        .map(config.createKeyPrefixer('thePrefix'))
    ).toEqual([
        'thePrefix.a',
        'thePrefix.b'
    ]);
});

test('createKeyPrefixer with "/" separator should map keys with prefix followed by "/"', () => {
    expect(['a', 'b']
        .map(config.createKeyPrefixer('thePrefix', '/'))
    ).toEqual([
        'thePrefix/a',
        'thePrefix/b'
    ]);
});
