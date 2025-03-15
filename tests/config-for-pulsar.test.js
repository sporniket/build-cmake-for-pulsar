const config = require('../lib/config-for-pulsar.js');
/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

test('loadAndWatch should load configuration and watch for changes on each key', () => {
    const settings = config.loadAndWatch(['a', 'b'], 'c');
    expect(settings).toEqual(
        new Map([
            ['a', new Map(['key', 'c.a'], ['value', 'value of c.a'])],
            ['b', new Map(['key', 'c.b'], ['value', 'value of c.b'])]
        ])
    );
    //TODO verify that the pulsar api has been called (on did change)
});
