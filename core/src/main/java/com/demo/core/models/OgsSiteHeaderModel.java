package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ValueMap;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import com.demo.core.models.ogs.OgsNavItem;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsSiteHeaderModel {

    private final Resource resource;

    @ValueMapValue
    private String logoLink;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    public OgsSiteHeaderModel(Resource resource) {
        this.resource = resource;
    }

    private List<OgsNavItem> navItems;

    @PostConstruct
    protected void init() {
        List<OgsNavItem> collected = new ArrayList<>();
        Resource root = resource.getChild("navItems");
        if (root != null) {
            for (Resource child : root.getChildren()) {
                ValueMap vm = child.getValueMap();
                collected.add(new OgsNavItem(
                    vm.get("label", ""),
                    vm.get("link", (String) null),
                    Boolean.parseBoolean(vm.get("active", "false"))
                ));
            }
        }
        navItems = collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    public String getLogoLink() {
        return logoLink;
    }

    public List<OgsNavItem> getNavItems() {
        return navItems;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return ctaLink;
    }
}
