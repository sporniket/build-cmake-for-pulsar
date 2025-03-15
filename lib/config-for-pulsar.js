/* SPDX-License-Identifier: GPL-3.0-or-later */
/****************************************

---
Copyright (C) 2025 David SPORN
---
This is part of **build-cmake-for-pulsar**.
Generate and build cmake projects from within Pulsar.
****************************************/

function loadAndWatch(keys, prefix, handleDidChange = (event)=>{ return event;/*dummy thing for eslint*/}) {
    handleDidChange(prefix);//dummy thing for eslint
    return new Map();
}

module.exports = {
    loadAndWatch
};
