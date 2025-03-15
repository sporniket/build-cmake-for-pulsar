/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

function loadConfigurationMap(keys = [], keyLoader, keyMapper = (k) => k) {
    const keyValueStructMapper = (k) => new Map([
        ['key', keyMapper(k)],
        ['value', keyLoader(keyMapper(k))]
    ]);
    return new Map(
        keys.map(k => [k, keyValueStructMapper(k)])
    );
}

module.exports = {
    loadConfigurationMap
};
