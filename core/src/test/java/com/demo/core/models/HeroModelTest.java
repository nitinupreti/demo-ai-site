/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class HeroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/hero-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-hero"); }});
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertNull(m.getHeading());
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/pos-hero");
        props.put("heading", "Navigating the digital landscape for success");
        props.put("body", "Our digital marketing agency helps businesses grow.");
        props.put("ctaText", "Book a consultation");
        props.put("ctaLink", "/content/demo-ai-site/us/en.html");
        props.put("illustration", "/content/dam/demo-ai-site/design/hero.png");
        props.put("illustrationAlt", "Megaphone");
        Resource r = context.create().resource("/content/test/hero-full", props);
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertEquals("Navigating the digital landscape for success", m.getHeading());
        assertEquals("Book a consultation", m.getCtaText());
        assertEquals("/content/demo-ai-site/us/en.html", m.getCtaLink());
        assertEquals("/content/dam/demo-ai-site/design/hero.png", m.getIllustration());
        assertEquals("Megaphone", m.getIllustrationAlt());
        assertTrue(m.isHasContent());
    }
}
