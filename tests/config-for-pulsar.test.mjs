import {jest} from '@jest/globals';

import * as config from '../lib/config-for-pulsar.js';

/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

const pulsar = {
    config: {
        get: jest.fn((x)=>`value of ${x}`).mockName('get'),
        onDidChange: jest.fn((x, handler)=>x).mockName('onDidChange')
    }
};

test('loadAndWatchSettingsFromPulsar should load configuration and watch for changes on each key', () => {
    //TODO : stub atom.config, mock get() and onDidChange()
    const settings = config.loadAndWatchSettingsFromPulsar(pulsar, ['a', 'b'], 'c');
    expect(settings).toEqual(
        new Map([
            ['a', new Map([['key', 'c.a'], ['value', 'value of c.a'], ['subscription', 'a']])],
            ['b', new Map([['key', 'c.b'], ['value', 'value of c.b'], ['subscription', 'b']])]
        ])
    );
    //TODO verify that the pulsar api has been called (on did change)
});
