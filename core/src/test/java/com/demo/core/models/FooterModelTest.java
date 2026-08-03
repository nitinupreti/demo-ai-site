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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class FooterModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/foot-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-footer"); }});
        FooterModel m = r.adaptTo(FooterModel.class);
        assertNotNull(m);
        assertEquals("Positivus", m.getLogoText());
        assertTrue(m.getNav().isEmpty());
    }

    @Test
    void configuredFully() {
        Map<String, Object> p = new HashMap<>();
        p.put("sling:resourceType", "demo-ai-site/components/pos-footer");
        p.put("logoText", "Positivus");
        p.put("email", "info@positivus.com");
        p.put("phone", "555-567-8901");
        p.put("copyright", "© 2023 Positivus. All Rights Reserved.");
        Resource parent = context.create().resource("/content/test/foot-full", p);
        Resource nav = context.create().resource(parent.getPath() + "/nav", new HashMap<>());
        Map<String, Object> n1 = new HashMap<>();
        n1.put("label", "About us");
        n1.put("link", "/content/about.html");
        context.create().resource(nav.getPath() + "/item0", n1);

        FooterModel m = parent.adaptTo(FooterModel.class);
        assertNotNull(m);
        assertEquals("info@positivus.com", m.getEmail());
        assertEquals(1, m.getNav().size());
        assertEquals("About us", m.getNav().get(0).getLabel());
    }
}
