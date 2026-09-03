/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class HeroModelTest {

    private static final String RESOURCE_TYPE = "demo-ai-site/components/hero";

    private final AemContext context = new AemContext();

    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(HeroModel.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "eyebrow", "Omnicom's Transformation Consultancy",
                "heading", "Powering Growth\nAcross Marketing and Tech",
                "body", "We help leading brands navigate complexity.",
                "ctaLabel", "What we do",
                "ctaLink", "/content/demo-ai-site/us/en/case-studies");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("Omnicom's Transformation Consultancy", model.getEyebrow());
        assertEquals("Powering Growth<br>Across Marketing and Tech", model.getHeading());
        assertEquals("We help leading brands navigate complexity.", model.getBody());
        assertEquals("What we do", model.getCtaLabel());
        assertEquals("/content/demo-ai-site/us/en/case-studies.html", model.getCtaHref());
        assertTrue(model.isHasContent());
    }

    @Test
    void testWhenEmpty() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE);

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertNull(model.getEyebrow());
        assertNull(model.getHeading());
        assertNull(model.getBody());
        assertNull(model.getCtaLabel());
        assertNull(model.getCtaHref());
        assertFalse(model.isHasContent());
    }

    @Test
    void testHeadingEscapesHtmlAndPreservesLineBreaks() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "heading", "Growth & <scale>\nis where we live");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("Growth &amp; &lt;scale&gt;<br>is where we live", model.getHeading());
        assertTrue(model.isHasContent());
    }

    @Test
    void testExternalCtaLinkIsNotSuffixed() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "ctaLabel", "Read on",
                "ctaLink", "https://credera.com/en-in/case-studies");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("https://credera.com/en-in/case-studies", model.getCtaHref());
    }

    @Test
    void testInternalContentLinkAlreadyExtensionIsNotDoubleSuffixed() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "ctaLabel", "Read on",
                "ctaLink", "/content/demo-ai-site/us/en/case-studies.html");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("/content/demo-ai-site/us/en/case-studies.html", model.getCtaHref());
    }

    @Test
    void testHasContentWithOnlyCtaLabelIsNotEnough() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "ctaLabel", "Read on");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
    }
}
