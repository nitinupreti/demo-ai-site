/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import com.demo.core.testcontext.AppAemContext;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;
import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class BenefitsGridModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/bg-empty",
            "sling:resourceType", "demo-ai-site/components/benefits-grid");
        BenefitsGridModel m = r.adaptTo(BenefitsGridModel.class);
        assertNotNull(m);
        assertTrue(m.getCallouts().isEmpty());
        assertFalse(m.isHasCallouts());
        assertFalse(m.isHasContent());
    }

    @Test
    void withCallouts() {
        Resource r = context.create().resource("/content/test/bg-full",
            "sling:resourceType", "demo-ai-site/components/benefits-grid",
            "title", "Smart Finance for everyone",
            "intro", "At Noble Finance we help everyone.");
        Resource callouts = context.create().resource(r, "callouts");
        context.create().resource(callouts, "item0",
            "icon", "/content/dam/demo-ai-site/freelancers.svg",
            "eyebrow", "For Freelancers",
            "calloutTitle", "Simplicity & Control",
            "description", "Stay in charge of your income.");
        context.create().resource(callouts, "item1",
            "eyebrow", "For Families",
            "calloutTitle", "Stability & Security",
            "description", "Plan for the future.");

        BenefitsGridModel m = r.adaptTo(BenefitsGridModel.class);
        assertNotNull(m);
        assertEquals("Smart Finance for everyone", m.getTitle());
        assertEquals(2, m.getCallouts().size());
        assertTrue(m.getCallouts().get(0).isHasIcon());
        assertFalse(m.getCallouts().get(1).isHasIcon());
        assertTrue(m.isHasCallouts());
        assertTrue(m.isHasContent());
    }
}
