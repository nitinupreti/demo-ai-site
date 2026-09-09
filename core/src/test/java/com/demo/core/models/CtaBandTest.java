package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class CtaBandTest {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(CtaBand.class);
    }

    @Test
    void testCompleteCtaBand() {
        Resource resource = context.create().resource("/content/cta",
                "headline", "Build faster",
                "subhead", "Supporting copy",
                "ctaLabel", "Request a demo",
                "ctaHref", "/contact-sales");

        CtaBand cta = resource.adaptTo(CtaBand.class);

        assertNotNull(cta);
        assertEquals("Build faster", cta.getHeadline());
        assertEquals("Supporting copy", cta.getSubhead());
        assertEquals("Request a demo", cta.getCtaLabel());
        assertEquals("/contact-sales", cta.getCtaHref());
        assertTrue(cta.isHasContent());
    }

    @Test
    void testEmptyCtaBand() {
        CtaBand cta = context.create().resource("/content/cta").adaptTo(CtaBand.class);

        assertNotNull(cta);
        assertFalse(cta.isHasContent());
    }
}