'use babel';
'use strict';

import * as config from 'config-loader-base-by-sporniket';

/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/
// See https://docs.pulsar-edit.dev/api/pulsar/latest/Config/
// * https://docs.pulsar-edit.dev/api/pulsar/latest/Config/#getting-and-setting-config-settings.
// * https://docs.pulsar-edit.dev/api/pulsar/latest/Config/#instance-ondidchange

function createConfigValueFromPulsarLoader(pulsar) {
    return (key) => pulsar.config.get(key);
}

function createHandlerOfDidChange(key, cache, onDidChange = (key, newValue, oldValue, map) => {}) {
    return ({
        newValue,
        oldValue
    }) => {
        cache.get(key).set('value', newValue);
        onDidChange(key, newValue, oldValue, map);
    };
}

export function loadAndWatchSettingsFromPulsar(pulsar, keys, prefix, onDidChange = (key, newValue, oldValue, map) => {}) {
    const settings = config.loadConfigurationMap(keys, createConfigValueFromPulsarLoader(pulsar), config.createKeyPrefixer(prefix));
    settings.forEach((value, key, map) => {
        map.get(key).set('subscription', pulsar.config.onDidChange(key, createHandlerOfDidChange(key, map, onDidChange)));
    });
    return settings;
}
