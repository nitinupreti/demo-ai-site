/*
 * Unit tests for HeaderModel.
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class HeaderModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource resource = context.create().resource("/content/test/header",
                "sling:resourceType", "demo-ai-site/components/header");
        HeaderModel model = resource.adaptTo(HeaderModel.class);
        assertNotNull(model);
        assertEquals("default", model.getStyle());
        assertEquals("Home", model.getBrandAlt());
        assertEquals("#", model.getBrandLink());
        assertNotNull(model.getNavItems());
        assertTrue(model.getNavItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource resource = context.create().resource("/content/test/header",
                "sling:resourceType", "demo-ai-site/components/header",
                "style", "default",
                "brandLogo", "/content/dam/demo-ai-site/design/logo.svg",
                "brandAlt", "Jadoo",
                "brandLink", "/content/demo-ai-site/us/en.html",
                "signupLabel", "Sign up",
                "signupLink", "/content/demo-ai-site/us/en/signup.html",
                "languageLabel", "EN",
                "languageLink", "#");
        // Add nav item children
        context.create().resource("/content/test/header/navItems/item0",
                "label", "Desitnations",
                "link", "/content/demo-ai-site/us/en/destinations.html",
                "active", Boolean.FALSE);
        context.create().resource("/content/test/header/navItems/item1",
                "label", "Hotels",
                "link", "/content/demo-ai-site/us/en/hotels.html",
                "active", Boolean.TRUE);
        context.create().resource("/content/test/header/navItems/item2",
                "label", "");

        HeaderModel model = resource.adaptTo(HeaderModel.class);
        assertNotNull(model);
        assertEquals("Jadoo", model.getBrandAlt());
        assertEquals("Sign up", model.getSignupLabel());
        assertEquals("EN", model.getLanguageLabel());
        List<NavItemModel> items = model.getNavItems();
        assertNotNull(items);
        assertEquals(2, items.size(), "empty-label items should be filtered");
        assertEquals("Desitnations", items.get(0).getLabel());
        assertFalse(items.get(0).isActive());
        assertEquals("Hotels", items.get(1).getLabel());
        assertTrue(items.get(1).isActive());
        assertTrue(model.isHasContent());
    }
}
