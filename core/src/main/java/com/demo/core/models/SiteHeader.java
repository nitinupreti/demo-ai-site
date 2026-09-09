package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class SiteHeader {

    @ValueMapValue
    private String logoText;

    @ValueMapValue
    private String logoHref;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaHref;

    @ValueMapValue
    private String secondaryLabel;

    @ValueMapValue
    private String secondaryHref;

    @ValueMapValue
    private String menuLabel;

    @ChildResource
    private List<NavItem> navItems;

    public String getLogoText() {
        return logoText;
    }

    public String getLogoHref() {
        return logoHref;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaHref() {
        return ctaHref;
    }

    public String getSecondaryLabel() {
        return secondaryLabel;
    }

    public String getSecondaryHref() {
        return secondaryHref;
    }

    public String getMenuLabel() {
        return Optional.ofNullable(menuLabel).orElse("Open menu");
    }

    public List<NavItem> getNavItems() {
        if (navItems == null) {
            return Collections.emptyList();
        }
        return navItems.stream()
                .filter(NavItem::hasContent)
                .collect(Collectors.toList());
    }

    public boolean isHasContent() {
        return getLogoText() != null && !getLogoText().isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class NavItem {
        @ValueMapValue
        private String label;

        @ValueMapValue
        private String href;

        public String getLabel() {
            return label;
        }

        public String getHref() {
            return href;
        }

        public boolean hasContent() {
            return label != null && !label.trim().isEmpty()
                    && href != null && !href.trim().isEmpty();
        }
    }
}
