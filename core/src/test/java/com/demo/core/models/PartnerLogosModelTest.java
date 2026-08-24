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
class PartnerLogosModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/pl-empty",
                "sling:resourceType", "demo-ai-site/components/partner-logos");
        PartnerLogosModel m = res.adaptTo(PartnerLogosModel.class);
        assertFalse(m.isHasContent());
        assertTrue(m.getLogos().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/pl",
                "sling:resourceType", "demo-ai-site/components/partner-logos");
        Resource logos = ctx.create().resource(root, "logos");
        ctx.create().resource(logos, "item0", "name", "Abcam", "link", "https://www.abcam.com/");
        ctx.create().resource(logos, "item1", "name", "Aldevron", "link", "https://www.aldevron.com/");

        PartnerLogosModel m = root.adaptTo(PartnerLogosModel.class);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getLogos().size());
        assertEquals("Abcam", m.getLogos().get(0).getName());
    }
}
