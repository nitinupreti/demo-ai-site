/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class SectionHeadingModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/sh-empty",
                "sling:resourceType", "demo-ai-site/components/section-heading");
        SectionHeadingModel m = res.adaptTo(SectionHeadingModel.class);
        assertFalse(m.isHasContent());
        assertEquals("center", m.getAlign());
        assertEquals("h2", m.getLevel());
    }

    @Test
    void configuredFully() {
        Resource res = ctx.create().resource("/content/sh",
                "sling:resourceType", "demo-ai-site/components/section-heading",
                "heading", "Push boundaries",
                "eyebrow", "PRODUCTS",
                "subheading", "sub",
                "align", "left",
                "level", "h3");
        SectionHeadingModel m = res.adaptTo(SectionHeadingModel.class);
        assertTrue(m.isHasContent());
        assertEquals("Push boundaries", m.getHeading());
        assertEquals("PRODUCTS", m.getEyebrow());
        assertEquals("left", m.getAlign());
        assertEquals("h3", m.getLevel());
    }
}
