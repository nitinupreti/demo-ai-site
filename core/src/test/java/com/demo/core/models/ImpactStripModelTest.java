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
class ImpactStripModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/is-empty",
                "sling:resourceType", "demo-ai-site/components/impact-strip");
        ImpactStripModel m = res.adaptTo(ImpactStripModel.class);
        assertFalse(m.isHasContent());
        assertEquals("left", m.getImageSide());
        assertTrue(m.getStats().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/is",
                "sling:resourceType", "demo-ai-site/components/impact-strip",
                "eyebrow", "SUSTAINABILITY IN ACTION",
                "title", "Our impact",
                "imageSide", "left");
        Resource stats = ctx.create().resource(root, "stats");
        ctx.create().resource(stats, "item0", "value", "121,000+", "label", "customer publications");
        ctx.create().resource(stats, "item1", "value", "100+", "label", "countries");

        ImpactStripModel m = root.adaptTo(ImpactStripModel.class);
        assertTrue(m.isHasContent());
        assertEquals("Our impact", m.getTitle());
        assertEquals(2, m.getStats().size());
        assertEquals("121,000+", m.getStats().get(0).getValue());
    }
}
