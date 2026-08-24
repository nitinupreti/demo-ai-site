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
class NewsletterSignupModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/ns-empty",
                "sling:resourceType", "demo-ai-site/components/newsletter-signup");
        NewsletterSignupModel m = res.adaptTo(NewsletterSignupModel.class);
        assertFalse(m.isHasContent());
        assertEquals("alt", m.getBackground());
    }

    @Test
    void configuredFully() {
        Resource res = ctx.create().resource("/content/ns",
                "sling:resourceType", "demo-ai-site/components/newsletter-signup",
                "eyebrow", "Stay up to date with IDT newsletter",
                "description", "Get access to expert webinars.",
                "ctaLabel", "SIGN ME UP",
                "ctaLink", "#",
                "background", "dark");
        NewsletterSignupModel m = res.adaptTo(NewsletterSignupModel.class);
        assertTrue(m.isHasContent());
        assertEquals("Stay up to date with IDT newsletter", m.getEyebrow());
        assertEquals("SIGN ME UP", m.getCtaLabel());
        assertEquals("dark", m.getBackground());
    }
}
