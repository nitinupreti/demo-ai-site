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
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class ServicesModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/svc-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-services"); }});
        ServicesModel m = r.adaptTo(ServicesModel.class);
        assertNotNull(m);
        assertTrue(m.getCards().isEmpty());
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource parent = context.create().resource("/content/test/svc-full",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-services"); }});
        Resource cards = context.create().resource(parent.getPath() + "/cards", new HashMap<>());
        Map<String, Object> c1 = new HashMap<>();
        c1.put("titleTop", "Search engine");
        c1.put("titleBottom", "optimization");
        c1.put("variant", "grey");
        c1.put("linkText", "Learn more");
        context.create().resource(cards.getPath() + "/item0", c1);
        Map<String, Object> c2 = new HashMap<>();
        c2.put("titleTop", "Content");
        c2.put("titleBottom", "Creation");
        c2.put("variant", "green");
        context.create().resource(cards.getPath() + "/item1", c2);

        ServicesModel m = parent.adaptTo(ServicesModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getCards().size());
        assertEquals("grey", m.getCards().get(0).getVariant());
        assertEquals("green", m.getCards().get(1).getVariant());
        assertEquals("Learn more", m.getCards().get(0).getLinkText());
    }
}
